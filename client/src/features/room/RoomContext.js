import { createContext, useContext } from 'react';

/** { service, feed } for the current room. */
export const RoomContext = createContext(null);

export function useRoom() {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error('useRoom must be used inside <RoomContext.Provider>');
  return ctx;
}
