import { useEffect, useRef, useState } from "react";
import {
  getAuth,
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signInWithPopup,
  type ConfirmationResult,
} from "firebase/auth";
import { ArrowRight, LockKeyhole, Network } from "lucide-react";

export default function SignIn() {
  const [phone, setPhone] = useState("+91");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationResult>();
  const [error, setError] = useState("");
  const verifier = useRef<RecaptchaVerifier | null>(null);
  useEffect(() => () => verifier.current?.clear(), []);
  async function attempt(action: () => Promise<unknown>) {
    setPending(true);
    setError("");
    try {
      await action();
    } catch {
      setError(
        "Sign-in could not be completed. Check your details and try again.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="signin">
      <section className="signin-story">
        <div className="wordmark">
          repaido<span>ENGINEERING</span>
        </div>
        <Network size={64} />
        <h1>
          One system.
          <br />
          Every connection.
        </h1>
        <p>A shared blueprint for the people who build Repaido.</p>
        <div className="signin-tags">
          <span>Architecture</span>
          <span>Activity</span>
          <span>Evidence</span>
        </div>
      </section>
      <section className="signin-form">
        <LockKeyhole size={26} />
        <h2>Your engineering workspace</h2>
        <p>Use your Repaido account. Engineering access is required.</p>
        <button
          className="primary"
          disabled={pending}
          onClick={() =>
            attempt(() => signInWithPopup(getAuth(), new GoogleAuthProvider()))
          }
        >
          Continue with Google <ArrowRight size={17} />
        </button>
        <div className="divider">or use your phone</div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            attempt(async () => {
              if (confirmation) await confirmation.confirm(code);
              else {
                if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
                  setError("Enter your number with its country code.");
                  return;
                }
                verifier.current ??= new RecaptchaVerifier(
                  getAuth(),
                  "phone-verifier",
                  { size: "normal" },
                );
                setConfirmation(
                  await signInWithPhoneNumber(
                    getAuth(),
                    phone,
                    verifier.current,
                  ),
                );
              }
            });
          }}
        >
          <label>
            {confirmation ? "Verification code" : "Phone number"}
            <input
              autoComplete={confirmation ? "one-time-code" : "tel"}
              type="tel"
              required
              value={confirmation ? code : phone}
              onChange={(e) =>
                confirmation
                  ? setCode(e.target.value)
                  : setPhone(e.target.value)
              }
            />
          </label>
          <div id="phone-verifier" />
          <button disabled={pending} type="submit">
            {pending
              ? "Please wait…"
              : confirmation
                ? "Verify & continue"
                : "Send verification code"}
          </button>
        </form>
        {confirmation && <p role="status">Code sent to your phone.</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <small>
          Access is checked on every request. This console cannot change
          production resources.
        </small>
      </section>
    </main>
  );
}
