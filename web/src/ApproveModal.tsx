import { useEffect, useRef, useState } from "react";
import type { TxRequest } from "./lib/backend";
import { demoName } from "./lib/demo";

export interface PendingApproval {
  req: TxRequest;
  resolve: () => void;
  reject: (e: Error) => void;
}

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms: number) => new Promise((r) => setTimeout(r, reduced() ? 0 : ms));

/**
 * Demo mode's stand-in for the wallet's approval window. It shows each step a
 * real QoreChain approval goes through, so a viewer sees where people sign.
 * On testnet, the QoreX extension shows its own window instead.
 */
export function ApproveModal(p: { pending: PendingApproval; onDone: () => void }) {
  const { req } = p.pending;
  const [phase, setPhase] = useState<"ask" | "sign">("ask");
  const [done, setDone] = useState(0);
  const approveRef = useRef<HTMLButtonElement>(null);

  const steps = [
    ...(req.opensWindow ? ["Open an EVM window for this app (QoreChain rule)"] : []),
    "Sign with secp256k1",
    "Sign with ML-DSA-87 (post-quantum)",
    req.lane === "native" ? "Broadcast to QoreChain" : "Broadcast to QoreChain EVM",
  ];

  useEffect(() => {
    approveRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase === "ask") reject();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function reject() {
    p.pending.reject(new Error("User rejected the request"));
    p.onDone();
  }

  async function approve() {
    setPhase("sign");
    for (let i = 0; i < steps.length; i++) {
      await wait(i === steps.length - 1 ? 650 : 520);
      setDone(i + 1);
    }
    await wait(450);
    p.pending.resolve();
    p.onDone();
  }

  return (
    <div className="wallet-veil" role="presentation">
      <div className="wallet" role="dialog" aria-modal="true" aria-labelledby="wallet-title">
        <div className="wallet-top">
          <span className="wallet-name">
            <i aria-hidden /> Wallet approval
          </span>
          <span className="wallet-tag">Demo · testnet</span>
        </div>
        <div className="wallet-site">
          <span className="muted small">Request from</span>
          <b>Last Light</b>
        </div>
        <div className="wallet-acct">
          <span className="avatar" aria-hidden>
            {demoName(req.from).slice(0, 1)}
          </span>
          <div>
            <b>{demoName(req.from)}</b>
            <code className="muted">{`${req.from.slice(0, 6)}…${req.from.slice(-4)}`}</code>
          </div>
        </div>

        <h3 id="wallet-title">{req.title}</h3>
        <p className="wallet-summary">{req.summary}</p>

        <dl className="wallet-details">
          {req.details.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
          <div>
            <dt>Signature</dt>
            <dd>Hybrid: secp256k1 + ML-DSA-87</dd>
          </div>
          <div>
            <dt>Network fee</dt>
            <dd>≈ 0.002 QOR (test tokens)</dd>
          </div>
        </dl>

        {req.opensWindow && phase === "ask" && (
          <p className="wallet-note">
            First contract call from this account: approving also opens a time-limited EVM window, which QoreChain requires before any EVM
            transaction.
          </p>
        )}

        {phase === "ask" ? (
          <div className="wallet-actions">
            <button className="btn ghost" onClick={reject}>
              Reject
            </button>
            <button className="btn primary" ref={approveRef} onClick={approve}>
              Approve
            </button>
          </div>
        ) : (
          <ol className="wallet-steps" aria-live="polite">
            {steps.map((s, i) => (
              <li key={s} className={i < done ? "done" : i === done ? "now" : ""}>
                {i < done ? (
                  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                    <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : i === done ? (
                  <span className="spin" aria-hidden />
                ) : (
                  <span className="dot" aria-hidden />
                )}
                <span>{s}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="wallet-foot">Simulated for the demo. On testnet, the QoreX wallet shows this approval.</p>
      </div>
    </div>
  );
}
