// Keep verified phone proofs only in memory. Never merge identities on an OTP collision.
export function createPhoneAccountRecovery({currentUid, signIn, now = Date.now}) {
  let pending = null;
  return {
    clear() { pending = null; },
    available() { return !!pending && pending.uid === currentUid() && pending.until > now(); },
    capture(error, credential, uid) {
      pending = null;
      if (!['auth/account-exists-with-different-credential', 'auth/credential-already-in-use'].includes(error?.code) || !credential || currentUid() !== uid) return false;
      pending = {credential, uid, until: now() + 120000};
      return true;
    },
    async continue() {
      if (!pending || pending.uid !== currentUid() || pending.until <= now()) {
        pending = null;
        throw new Error('Your verification session changed or expired. Request a new code.');
      }
      const {credential} = pending;
      pending = null; // A failed/uncertain sign-in requires a fresh OTP; never replay a proof.
      return signIn(credential);
    }
  };
}
