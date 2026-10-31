import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

// One-time codes (6 digits) sent by email or SMS, stored in the otp_codes collection.
//
// Only an HMAC of each code is kept. A code works once, for 10 minutes, with at most 5
// guesses; a new one can be sent after 60 seconds, and at most 5 per hour go to the same
// address or number. Every guess is counted before it is checked, so guessing in
// parallel does not get around the limit.

export const OTP_TTL_MINUTES = 10;
export const MAX_ATTEMPTS = 5;
export const RESEND_SECONDS = 60;
const MAX_PER_HOUR = 5;

export class OtpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

/** "a***@gmail.com", "+91******3210": enough to recognise, not enough to harvest. */
export function maskTarget(channel, target) {
  if (channel === 'sms') return `${target.slice(0, 3)}${'*'.repeat(Math.max(target.length - 7, 2))}${target.slice(-4)}`;
  const [local, domain] = target.split('@');
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(local.length - 1, 2))}@${domain}`;
}

const MESSAGES = {
  signup: { subject: 'Your SYNQ verification code', lead: 'Use this code to finish creating your SYNQ account' },
  login: { subject: 'Your SYNQ login code', lead: 'Use this code to log in to SYNQ' },
  phone: { subject: 'Your SYNQ phone code', lead: 'Use this code to verify your phone number on SYNQ' },
};

export class Verifier {
  constructor({ db, secret, sender }) {
    this.codes = db?.collection('otp_codes');
    this.secret = secret;
    this.sender = sender;
  }

  hash(id, code) {
    return createHmac('sha256', this.secret).update(`${id}:${code}`).digest('hex');
  }

  newCode() {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  /** What the client is told: never the code, and the address only masked. */
  view(row) {
    return {
      id: row._id,
      channel: row.channel,
      to: maskTarget(row.channel, row.target),
      expiresIn: OTP_TTL_MINUTES * 60,
      resendIn: RESEND_SECONDS,
    };
  }

  async deliver(row, code) {
    const { subject, lead } = MESSAGES[row.purpose];
    const text = `${lead}: ${code}\n\nIt expires in ${OTP_TTL_MINUTES} minutes. If you did not ask for it, ignore this message.`;
    try {
      if (row.channel === 'sms') await this.sender.sendSms({ to: row.target, body: `SYNQ code: ${code} (valid ${OTP_TTL_MINUTES} min)` });
      else {
        await this.sender.sendEmail({
          to: row.target,
          subject,
          text,
          html: `<p>${lead}:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p style="color:#666">It expires in ${OTP_TTL_MINUTES} minutes. If you did not ask for it, ignore this email.</p>`,
        });
      }
    } catch (err) {
      console.error(`[synq] could not send a ${row.channel} code:`, err.message);
      throw new OtpError(502, `The ${row.channel === 'sms' ? 'SMS' : 'email'} could not be sent. Try again in a moment.`);
    }
  }

  /**
   * Creates a code and sends it. deliver=false makes a code that is never sent (used for
   * unknown addresses on the login form, so it does not reveal who has an account).
   */
  async create({ purpose, channel, target, userId = null, payload = null, deliver = true }) {
    const recent = await this.codes.countDocuments({ target, createdAt: { $gt: new Date(Date.now() - 3600_000) } });
    if (recent >= MAX_PER_HOUR) throw new OtpError(429, 'Too many codes were sent to this address. Try again in an hour.');
    const code = this.newCode();
    const now = new Date();
    const row = {
      _id: randomUUID(),
      purpose,
      channel,
      target,
      userId,
      payload,
      codeHash: null,
      attempts: 0,
      expiresAt: new Date(now.getTime() + OTP_TTL_MINUTES * 60_000),
      consumedAt: null,
      lastSentAt: now,
      createdAt: now,
    };
    row.codeHash = this.hash(row._id, code);
    await this.codes.insertOne(row);
    if (deliver) await this.deliver(row, code);
    return this.view(row);
  }

  /** A fresh code for the same request (after RESEND_SECONDS). */
  async resend(id) {
    const row = await this.codes.findOne({ _id: String(id || ''), consumedAt: null, createdAt: { $gt: new Date(Date.now() - 3600_000) } });
    if (!row) throw new OtpError(400, 'This code request has ended. Start again.');
    const since = Math.floor((Date.now() - row.lastSentAt.getTime()) / 1000);
    if (since < RESEND_SECONDS) {
      throw new OtpError(429, `Wait ${RESEND_SECONDS - since} seconds before asking for a new code.`, { retryIn: RESEND_SECONDS - since });
    }
    const code = this.newCode();
    await this.codes.updateOne(
      { _id: row._id },
      { $set: { codeHash: this.hash(row._id, code), attempts: 0, lastSentAt: new Date(), expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000) } },
    );
    // Codes for unknown addresses are never sent (see create).
    if (row.purpose !== 'login' || row.userId) await this.deliver(row, code);
    return this.view(row);
  }

  /**
   * Checks a code. Resolves the row (used up from now on), or throws a 400/429.
   * guard(row) runs after the code matched and before it is used up: it can refuse
   * (throw) without burning the code, e.g. when the wrong person entered it.
   */
  async verify(id, code, guard = null) {
    const clean = String(code || '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(clean)) throw new OtpError(400, 'Enter the 6-digit code.');
    if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) throw new OtpError(400, 'This code request has ended. Start again.');
    // The guess is counted first (atomically), then checked.
    const row = await this.codes.findOneAndUpdate({ _id: id, consumedAt: null }, { $inc: { attempts: 1 } }, { returnDocument: 'after' });
    if (!row) throw new OtpError(400, 'This code was already used or has ended. Ask for a new one.');
    if (row.expiresAt < new Date()) throw new OtpError(400, 'This code has expired. Ask for a new one.');
    if (row.attempts > MAX_ATTEMPTS) throw new OtpError(429, 'Too many wrong codes. Ask for a new one.');
    const expected = Buffer.from(row.codeHash, 'hex');
    const actual = Buffer.from(this.hash(row._id, clean), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      const left = MAX_ATTEMPTS - row.attempts;
      throw new OtpError(400, left > 0 ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong codes. Ask for a new one.');
    }
    await guard?.(row);
    const used = await this.codes.updateOne({ _id: id, consumedAt: null }, { $set: { consumedAt: new Date() } });
    if (!used.modifiedCount) throw new OtpError(400, 'This code was already used. Ask for a new one.');
    return row;
  }
}
