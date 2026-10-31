import nodemailer from 'nodemailer';

// How verification codes reach people.
//
//   Email: any SMTP server. With Gmail: SMTP_HOST=smtp.gmail.com, SMTP_PORT=465,
//          SMTP_USER=you@gmail.com, SMTP_PASS=<16-character app password>.
//   SMS:   Twilio (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM).
//
// OTP_DEV_LOG=true prints codes that cannot be sent (no provider set up) in the server
// log instead, so sign-up works during development. Never turn it on for real users.

export function createSender(env = process.env) {
  const smtp = env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS;
  const twilio = env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM;
  const devLog = String(env.OTP_DEV_LOG || '').toLowerCase() === 'true';
  const port = Number(env.SMTP_PORT) || 465;
  const transport = smtp
    ? nodemailer.createTransport({ host: env.SMTP_HOST, port, secure: port === 465, auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } })
    : null;
  const from = env.MAIL_FROM || (smtp ? `SYNQ <${env.SMTP_USER}>` : '');

  const devPrint = (kind, to, text) => console.log(`[synq] (OTP_DEV_LOG) ${kind} to ${to}: ${text}`);

  return {
    email: !!smtp || devLog,
    sms: !!twilio || devLog,
    devLog: devLog && !(smtp && twilio),
    label: `email ${smtp ? `via ${env.SMTP_HOST}` : devLog ? 'printed in this log (dev)' : 'off'}, SMS ${twilio ? 'via Twilio' : devLog ? 'printed in this log (dev)' : 'off'}`,

    /** Logs in to the SMTP server once (at start), so a wrong password shows up right away. */
    async checkEmail() {
      if (!transport) return null;
      try {
        await transport.verify();
        return { ok: true, message: `connected to ${env.SMTP_HOST} as ${env.SMTP_USER}` };
      } catch (err) {
        const hint = /535|BadCredentials|Username and Password not accepted/i.test(err.message)
          ? ' (Gmail needs an App password, not your normal password)'
          : '';
        return { ok: false, message: `${err.message.split('\n')[0]}${hint}` };
      }
    },

    async sendEmail({ to, subject, text, html }) {
      if (!transport) {
        if (devLog) return devPrint('email', to, text);
        throw new Error('Email is not set up on this server (SMTP_HOST, SMTP_USER, SMTP_PASS).');
      }
      await transport.sendMail({ from, to, subject, text, html });
      return undefined;
    },

    async sendSms({ to, body }) {
      if (!twilio) {
        if (devLog) return devPrint('SMS', to, body);
        throw new Error('SMS is not set up on this server (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM).');
      }
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: to, From: env.TWILIO_FROM, Body: body }),
      });
      if (!res.ok) throw new Error(`SMS provider refused the message (${res.status}).`);
      return undefined;
    },
  };
}
