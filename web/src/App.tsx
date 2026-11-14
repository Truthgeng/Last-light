import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { generateKemKeyPair, kemKeyFingerprint, equalBytes, type KemKeyPair } from "@last-light/crypto";
import { toEvmAddress } from "@qorechain/evm";
import { HeroCanvas } from "./HeroCanvas";
import { DemoBackend, PERSONAS } from "./lib/demo";
import { LiveBackend, LIVE_CONTRACT, EXPLORER_TX } from "./lib/live";
import { demoKeys, liveKeys, type KeyStore } from "./lib/keystore";
import { handOff, openVault, sealAndCreate, short } from "./lib/flows";
import { sameAddress, type Address, type Backend, type VaultView } from "./lib/backend";

type Mode = "demo" | "live";
interface FeedItem {
  id: number;
  at: Date;
  text: string;
  tx?: string;
}

const DAY = 86400n;
const PERIODS: { label: string; value: bigint }[] = [
  { label: "10 minutes (for testing)", value: 600n },
  { label: "30 days", value: 30n * DAY },
  { label: "90 days", value: 90n * DAY },
  { label: "180 days", value: 180n * DAY },
  { label: "1 year", value: 365n * DAY },
];
const SAMPLE_PHRASE = "sample phrase only: velvet orbit candle harbor quiet meadow pilot ember river stone lantern dawn";

function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/User rejected|rejected the request|denied/i.test(m)) return "You cancelled the request in your wallet.";
  if (/not yet supported/i.test(m)) return `QoreX said: ${m}. Update QoreX to the latest version and try again.`;
  return m.split("\n")[0].slice(0, 300);
}

function duration(s: bigint): string {
  if (s <= 0n) return "now";
  const d = s / DAY;
  const hr = (s % DAY) / 3600n;
  const min = (s % 3600n) / 60n;
  if (d > 0n) return `${d}d ${hr}h`;
  if (hr > 0n) return `${hr}h ${min}m`;
  if (min > 0n) return `${min}m`;
  return `${s}s`;
}

function periodLabel(p: bigint): string {
  return PERIODS.find((x) => x.value === p)?.label.replace(" (for testing)", "") ?? duration(p);
}

function normalizeAddress(input: string): Address {
  const s = input.trim();
  if (/^qor1[0-9a-z]{38,}$/.test(s)) return toEvmAddress(s) as Address;
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return s.toLowerCase() as Address;
  throw new Error(`"${s || "(empty)"}" is not a 0x or qor1 address.`);
}

/* ------------------------------------------------------------------ */

export function App() {
  const demo = useMemo(() => new DemoBackend(), []);
  const live = useMemo(() => (LIVE_CONTRACT ? new LiveBackend(LIVE_CONTRACT) : null), []);
  const params = new URLSearchParams(location.search);
  const [mode, setMode] = useState<Mode>(live && !params.has("demo") ? "live" : "demo");
  const backend: Backend = mode === "live" && live ? live : demo;
  const keys = mode === "live" ? liveKeys : demoKeys;

  const { address } = useAccount();
  const [persona, setPersona] = useState(0);
  const me: Address | undefined = mode === "demo" ? PERSONAS[persona].address : (address?.toLowerCase() as Address | undefined);

  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const feedId = useRef(0);
  const log = useCallback((text: string, tx?: string) => {
    feedId.current++;
    setFeed((f) => [{ id: feedId.current, at: new Date(), text, tx }, ...f].slice(0, 12));
  }, []);

  useEffect(() => {
    setFeed([]);
  }, [mode]);

  const nameOf = useCallback(
    (a: string) => (mode === "demo" ? PERSONAS.find((p) => sameAddress(p.address, a))?.name ?? short(a) : sameAddress(a, me) ? "You" : short(a)),
    [mode, me],
  );

  return (
    <>
      <div className="ambient" aria-hidden />
      <nav className="nav">
        <div className="nav-inner">
          <a className="brand" href="#top">
            <Mark />
            <span>Last Light</span>
          </a>
          <div className="nav-links">
            <a href="#how">How it works</a>
            <a href="#app">App</a>
            <a href="#limits">Limits</a>
          </div>
          <div className="nav-right">
            <span className="tag net">QoreChain testnet</span>
            <a className="btn small ghost gh" href="https://github.com/Truthgeng/Last-light" target="_blank" rel="noreferrer">
              GitHub
            </a>
          </div>
        </div>
      </nav>

      <header className="hero" id="top">
        <div className="hero-copy">
          <h1>Your keys should outlive you.</h1>
          <p className="sub">
            Leave your seed phrase to someone you trust. It stays locked with post-quantum encryption until you stop checking in and two of your
            three guardians agree to release it.
          </p>
          <div className="ctas">
            <a
              className="btn primary"
              href="#app"
              onClick={() => {
                setMode("demo");
              }}
            >
              Try the demo
            </a>
            <a className="btn ghost" href="#how">
              See how it works
            </a>
          </div>
          <ul className="facts">
            <li>
              <b>ML-KEM-1024</b>
              <span>NIST FIPS 203 encryption</span>
            </li>
            <li>
              <b>2 of 3</b>
              <span>guardians must agree</span>
            </li>
            <li>
              <b>0 bytes</b>
              <span>readable on chain</span>
            </li>
            <li>
              <b>Hybrid-signed</b>
              <span>secp256k1 + ML-DSA-87</span>
            </li>
          </ul>
        </div>
        <div className="hero-visual">
          <HeroCanvas />
        </div>
      </header>

      <main>
        <section id="how" className="section">
          <div className="section-head">
            <h2>Locked until it should open. Then only for one person.</h2>
            <p>
              Classical encryption saved today can be stored and broken later by a quantum computer. A seed phrase has to stay secret for decades,
              so Last Light encrypts it with ML-KEM-1024, to keys each person publishes on QoreChain.
            </p>
          </div>
          <div className="steps">
            <Step n="01" title="Everyone publishes a key">
              Your heir and guardians create an ML-KEM-1024 key in their browser and publish the public half on QoreChain. The private half never
              leaves their device.
            </Step>
            <Step n="02" title="You seal the vault">
              Your browser encrypts the phrase, then splits the key that opens it. Half A goes to your heir. Half B is split again across three
              guardians. Only locked pieces reach the chain.
            </Step>
            <Step n="03" title="You check in">
              One transaction every period, for example every 90 days. Each check-in moves the release date forward.
            </Step>
            <Step n="04" title="Two guardians release it">
              Miss a check-in and the vault is released. Two guardians pass their shares to your heir, who joins them with Half A and opens the
              vault in their browser.
            </Step>
          </div>
        </section>

        <section id="app" className="section">
          <div className="app-bar glass">
            <div className="mode-switch" role="tablist" aria-label="Mode">
              <button role="tab" aria-selected={mode === "demo"} className={mode === "demo" ? "on" : ""} onClick={() => setMode("demo")}>
                Demo
              </button>
              <button
                role="tab"
                aria-selected={mode === "live"}
                className={mode === "live" ? "on" : ""}
                onClick={() => setMode("live")}
                disabled={!live}
                title={live ? "Use the LastLight contract on the QoreChain testnet" : "The contract address is not set in this build"}
              >
                Testnet
              </button>
            </div>
            {mode === "demo" ? (
              <DemoBar demo={demo} persona={persona} setPersona={setPersona} refresh={refresh} log={log} />
            ) : (
              <div className="live-bar">
                <span className="muted small">
                  Contract <code>{short(LIVE_CONTRACT)}</code>
                </span>
                <ConnectButton chainStatus="none" showBalance={false} accountStatus="address" />
              </div>
            )}
          </div>

          {mode === "demo" && (
            <p className="note">
              Demo mode: the people are samples and the chain is simulated in your browser, but the encryption is the real ML-KEM-1024 code the
              testnet app uses. Switch people above to play each role.
            </p>
          )}

          {!me ? (
            <div className="glass empty">
              <h3>Connect QoreX to start</h3>
              <p className="muted">
                Use the QoreX wallet on Testnet. Your account needs its post-quantum key registered, which QoreX does for you on your first
                transaction.
              </p>
              <ConnectButton chainStatus="none" showBalance={false} />
            </div>
          ) : (
            <div className="board" key={`${mode}-${me}`}>
              <div className="col">
                <KeyPanel backend={backend} me={me} keys={keys} tick={tick} refresh={refresh} log={log} isOwnerPersona={mode === "demo" && persona === 0} />
                <SealPanel backend={backend} me={me} mode={mode} tick={tick} refresh={refresh} log={log} nameOf={nameOf} />
              </div>
              <div className="col">
                <VaultsPanel backend={backend} me={me} keys={keys} tick={tick} refresh={refresh} log={log} nameOf={nameOf} />
                <FeedPanel feed={feed} mode={mode} />
              </div>
            </div>
          )}
        </section>

        <section id="limits" className="section">
          <div className="section-head">
            <h2>What it protects against, and what it does not</h2>
          </div>
          <div className="limits">
            <div className="glass panel">
              <h3>Protected</h3>
              <ul className="ticks">
                <li>Anyone reading the chain, today or with a future quantum computer</li>
                <li>Your heir opening the vault early: they hold only Half A</li>
                <li>One guardian working with your heir: two shares are needed</li>
                <li>All three guardians together: they never see Half A</li>
                <li>Pieces copied from one vault into another: every piece is bound to its vault, role and recipient</li>
              </ul>
            </div>
            <div className="glass panel">
              <h3>Not protected</h3>
              <ul className="crosses">
                <li>Your heir and two guardians agreeing to open it early. Pick guardians who do not all answer to your heir.</li>
                <li>A lost key. If your heir loses their Last Light key and its backup, the vault cannot be opened.</li>
                <li>A compromised device. Encryption happens in the browser, so the browser must be trusted.</li>
                <li>
                  This is a hackathon build on a testnet. Use a test phrase. <b>Never put a real seed phrase in it.</b>
                </li>
              </ul>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <span>Last Light. Built for QoreChain Build Before Q-Day, Encrypted Apps.</span>
        <span className="muted">Apache-2.0</span>
      </footer>
    </>
  );
}

/* ------------------------------------------------------------------ */

function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
      <defs>
        <linearGradient id="mk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffd08a" />
          <stop offset="1" stopColor="#ff6a3d" />
        </linearGradient>
      </defs>
      <path d="M3 14a8 8 0 0 1 16 0z" fill="url(#mk)" />
      <rect x="1" y="15.5" width="20" height="1.6" rx=".8" fill="#f3ede4" opacity=".85" />
      <rect x="5" y="18.6" width="12" height="1.4" rx=".7" fill="#f3ede4" opacity=".45" />
    </svg>
  );
}

function Step(p: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="glass step">
      <span className="step-n">{p.n}</span>
      <h3>{p.title}</h3>
      <p>{p.children}</p>
    </div>
  );
}

function DemoBar(p: { demo: DemoBackend; persona: number; setPersona: (i: number) => void; refresh: () => void; log: (t: string) => void }) {
  return (
    <div className="demo-bar">
      <div className="people" role="tablist" aria-label="Play as">
        {PERSONAS.map((x, i) => (
          <button key={x.address} role="tab" aria-selected={p.persona === i} className={p.persona === i ? "on" : ""} onClick={() => p.setPersona(i)}>
            <b>{x.name}</b>
            <span>{x.role}</span>
          </button>
        ))}
      </div>
      <div className="skip">
        <button
          className="btn small ghost"
          onClick={() => {
            p.demo.skip(30n * DAY);
            p.log("Clock moved forward 30 days");
            p.refresh();
          }}
        >
          Skip 30 days
        </button>
        <button
          className="btn small ghost"
          onClick={() => {
            p.demo.skip(91n * DAY);
            p.log("Clock moved forward 91 days");
            p.refresh();
          }}
        >
          Skip 91 days
        </button>
      </div>
    </div>
  );
}

function Status(p: { kind: "ok" | "err" | "busy" | "info"; children: React.ReactNode }) {
  return (
    <div className={`status ${p.kind}`} role={p.kind === "err" ? "alert" : "status"}>
      {p.kind === "ok" && <Check />}
      {p.kind === "busy" && <span className="spin" aria-hidden />}
      <span>{p.children}</span>
    </div>
  );
}

function Check() {
  return (
    <svg className="check" width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type Msg = { kind: "ok" | "err" | "busy" | "info"; text: string } | null;

/* ------------------------------------------------------------------ */

function KeyPanel(p: {
  backend: Backend;
  me: Address;
  keys: KeyStore;
  tick: number;
  refresh: () => void;
  log: (t: string, tx?: string) => void;
  isOwnerPersona: boolean;
}) {
  const [onChain, setOnChain] = useState<Uint8Array | null | undefined>(undefined);
  const [local, setLocal] = useState<KemKeyPair | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    setLocal(p.keys.load(p.me));
    p.backend
      .kemKeyOf(p.me)
      .then((k) => live && setOnChain(k))
      .catch((e) => live && (setOnChain(null), setMsg({ kind: "err", text: `Could not read your key from the chain: ${errText(e)}` })));
    return () => {
      live = false;
    };
  }, [p.backend, p.me, p.keys, p.tick]);

  const matches = onChain && local && equalBytes(onChain, local.publicKey);

  async function publish() {
    setMsg({ kind: "busy", text: "Creating your ML-KEM-1024 key and asking QoreX to publish it…" });
    try {
      const kp = local && !onChain ? local : generateKemKeyPair();
      // Save first, so a key that reaches the chain is never lost from this device.
      p.keys.save(p.me, kp);
      setLocal(kp);
      const tx = await p.backend.publishKemKey(p.me, kp.publicKey);
      p.log("Published a Last Light key", tx);
      setMsg({ kind: "ok", text: "Key published. Download a backup now: without it, a lost browser means a lost key." });
      p.refresh();
    } catch (e) {
      setMsg({ kind: "err", text: errText(e) });
    }
  }

  function backup() {
    const b = p.keys.backup(p.me);
    if (!b) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(b, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `last-light-key-${p.me.slice(2, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function restore(f: File) {
    try {
      const kp = p.keys.restore(p.me, await f.text());
      setLocal(kp);
      setMsg({ kind: "ok", text: "Key restored on this device." });
    } catch (e) {
      setMsg({ kind: "err", text: errText(e) });
    }
  }

  return (
    <div className="glass panel key-panel">
      <div className="panel-head">
        <h3>Your Last Light key</h3>
        {matches ? <span className="pill ok">Ready</span> : onChain === undefined ? <span className="pill">Checking</span> : <span className="pill warn">Action needed</span>}
      </div>

      {onChain === undefined ? (
        <p className="muted">Reading the chain…</p>
      ) : matches ? (
        <>
          <p className="muted">Heirs and guardians use this key to receive their pieces. It is published on chain and stored on this device.</p>
          <div className="fp">
            <span className="muted small">Fingerprint</span>
            <code>{kemKeyFingerprint(onChain!)}</code>
          </div>
          <div className="row">
            <button className="btn small ghost" onClick={backup}>
              Download backup
            </button>
          </div>
        </>
      ) : onChain && !local ? (
        <>
          <p>Your key is on chain, but its private half is not on this device. Restore it from your backup file.</p>
          <div className="row">
            <button className="btn small primary" onClick={() => fileRef.current?.click()}>
              Restore from backup
            </button>
            <button className="btn small ghost" onClick={publish}>
              Replace with a new key
            </button>
          </div>
        </>
      ) : onChain && local && !matches ? (
        <>
          <p>The key on this device is not the one on chain. Restore the right backup, or publish this one to replace it.</p>
          <div className="row">
            <button className="btn small primary" onClick={() => fileRef.current?.click()}>
              Restore from backup
            </button>
            <button className="btn small ghost" onClick={publish}>
              Publish this device's key
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">
            {p.isOwnerPersona
              ? "Owners do not need a key to seal a vault. Heirs and guardians do, so they can receive their pieces."
              : "To be named as an heir or guardian, publish an ML-KEM-1024 key. It takes one hybrid-signed transaction."}
          </p>
          <div className="row">
            <button className="btn small primary" onClick={publish}>
              Create and publish my key
            </button>
          </div>
        </>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void restore(f);
          e.target.value = "";
        }}
      />
      {msg && <Status kind={msg.kind}>{msg.text}</Status>}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SealPanel(p: {
  backend: Backend;
  me: Address;
  mode: Mode;
  tick: number;
  refresh: () => void;
  log: (t: string, tx?: string) => void;
  nameOf: (a: string) => string;
}) {
  const demoFill = p.mode === "demo" && sameAddress(p.me, PERSONAS[0].address);
  const [heir, setHeir] = useState(demoFill ? PERSONAS[1].address : "");
  const [gs, setGs] = useState<string[]>(demoFill ? PERSONAS.slice(2).map((x) => x.address) : ["", "", ""]);
  const [period, setPeriod] = useState<bigint>(p.mode === "demo" ? 90n * DAY : 600n);
  const [secret, setSecret] = useState(p.mode === "demo" ? SAMPLE_PHRASE : "");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const heirA = normalizeAddress(heir);
      const gA = gs.map(normalizeAddress);
      if (!secret.trim()) throw new Error("Type the secret you want to leave.");
      setMsg({ kind: "busy", text: "Encrypting in your browser and sealing the vault…" });
      const { tx } = await sealAndCreate(p.backend, p.me, { secret: secret.trim(), heir: heirA, guardians: gA, threshold: 2, period });
      p.log(`Sealed a vault for ${p.nameOf(heirA)}`, tx);
      setMsg({ kind: "ok", text: "Vault sealed. Nothing readable left your browser." });
      if (p.mode === "live") setSecret("");
      p.refresh();
    } catch (err) {
      setMsg({ kind: "err", text: errText(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="glass panel seal-panel" onSubmit={submit}>
      <div className="panel-head">
        <h3>Seal a vault</h3>
        <span className="pill">You are the owner</span>
      </div>
      <label>
        <span>Heir</span>
        <AddrInput value={heir} onChange={setHeir} backend={p.backend} tick={p.tick} nameOf={p.nameOf} />
      </label>
      <div className="g3">
        {gs.map((g, i) => (
          <label key={i}>
            <span>Guardian {i + 1}</span>
            <AddrInput value={g} onChange={(v) => setGs((x) => x.map((y, j) => (j === i ? v : y)))} backend={p.backend} tick={p.tick} nameOf={p.nameOf} />
          </label>
        ))}
      </div>
      <p className="hint">Any two of the three guardians can release the vault once you miss a check-in.</p>
      <label>
        <span>Check in every</span>
        <select value={period.toString()} onChange={(e) => setPeriod(BigInt(e.target.value))}>
          {PERIODS.map((x) => (
            <option key={x.label} value={x.value.toString()}>
              {x.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Secret to leave</span>
        <textarea rows={3} value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="A test seed phrase or wallet instructions" spellCheck={false} />
      </label>
      <p className="hint warn-text">Testnet build: use a test phrase, never a real one.</p>
      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? "Sealing…" : "Seal vault"}
      </button>
      {msg && <Status kind={msg.kind}>{msg.text}</Status>}
    </form>
  );
}

function AddrInput(p: { value: string; onChange: (v: string) => void; backend: Backend; tick: number; nameOf: (a: string) => string }) {
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    let live = true;
    setState(null);
    let a: Address;
    try {
      a = normalizeAddress(p.value);
    } catch {
      return;
    }
    const t = setTimeout(() => {
      p.backend
        .kemKeyOf(a)
        .then((k) => live && setState(k ? { ok: true, text: `${p.nameOf(a)} · key ${kemKeyFingerprint(k)}` } : { ok: false, text: `${p.nameOf(a)} has not published a key yet` }))
        .catch(() => live && setState({ ok: false, text: "Could not check this address" }));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [p.value, p.backend, p.tick, p.nameOf]);
  return (
    <>
      <input value={p.value} onChange={(e) => p.onChange(e.target.value)} placeholder="0x… or qor1…" spellCheck={false} autoComplete="off" />
      {state && <small className={state.ok ? "key-ok" : "key-missing"}>{state.text}</small>}
    </>
  );
}

/* ------------------------------------------------------------------ */

function VaultsPanel(p: {
  backend: Backend;
  me: Address;
  keys: KeyStore;
  tick: number;
  refresh: () => void;
  log: (t: string, tx?: string) => void;
  nameOf: (a: string) => string;
}) {
  const [vaults, setVaults] = useState<VaultView[] | null>(null);
  const [now, setNow] = useState<bigint>(0n);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const [ids, t] = await Promise.all([p.backend.vaultsOf(p.me), p.backend.now()]);
        const vs = await Promise.all(ids.map((id) => p.backend.getVault(id)));
        if (live) {
          setVaults(vs.reverse());
          setNow(t);
          setErr(null);
        }
      } catch (e) {
        if (live) setErr(errText(e));
      }
    };
    void load();
    const t = setInterval(load, p.backend.mode === "live" ? 15000 : 5000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [p.backend, p.me, p.tick]);

  return (
    <div className="glass panel vaults-panel">
      <div className="panel-head">
        <h3>Your vaults</h3>
        {vaults && <span className="pill">{vaults.length}</span>}
      </div>
      {err && <Status kind="err">{err}</Status>}
      {!vaults ? (
        <p className="muted">Loading…</p>
      ) : vaults.length === 0 ? (
        <p className="muted">No vaults yet. Vaults you seal, inherit or guard show up here.</p>
      ) : (
        <div className="vault-list">
          {vaults.map((v) => (
            <VaultCard key={v.id.toString()} v={v} now={now} {...p} />
          ))}
        </div>
      )}
    </div>
  );
}

function VaultCard(p: {
  v: VaultView;
  now: bigint;
  backend: Backend;
  me: Address;
  keys: KeyStore;
  refresh: () => void;
  log: (t: string, tx?: string) => void;
  nameOf: (a: string) => string;
}) {
  const { v } = p;
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  const isOwner = sameAddress(v.owner, p.me);
  const isHeir = sameAddress(v.heir, p.me);
  const gIndex = v.guardians.findIndex((g) => sameAddress(g, p.me));
  const role = isOwner ? "Owner" : isHeir ? "Heir" : gIndex >= 0 ? `Guardian ${gIndex + 1}` : "";
  const openable = v.released && v.handoffCount >= v.threshold;
  const left = v.releaseAt - p.now;
  const progress = v.period > 0n ? Math.max(0, Math.min(1, Number(left) / Number(v.period))) : 0;

  async function run(label: string, f: () => Promise<string>, done: string) {
    setBusy(true);
    setMsg({ kind: "busy", text: label });
    try {
      const tx = await f();
      p.log(done, tx);
      setMsg({ kind: "ok", text: done });
      p.refresh();
    } catch (e) {
      setMsg({ kind: "err", text: errText(e) });
    } finally {
      setBusy(false);
    }
  }

  function myKey(): KemKeyPair {
    const k = p.keys.load(p.me);
    if (!k) throw new Error("Your Last Light key is not on this device. Restore it from your backup first.");
    return k;
  }

  const status = v.cancelled ? "Cancelled" : openable ? "Ready to open" : v.released ? "Released" : "Sealed";

  return (
    <article className={`vault ${v.released ? "released" : ""} ${v.cancelled ? "cancelled" : ""}`}>
      <header>
        <div>
          <span className="pill role">{role}</span>
          <span className={`pill st ${status.replace(/ /g, "-").toLowerCase()}`}>{status}</span>
        </div>
        <code className="vid" title={v.id.toString()}>
          #{v.id.toString(16).slice(-6)}
        </code>
      </header>

      <div className="vault-body">
        <Ring value={v.cancelled ? 0 : v.released ? 0 : progress} label={v.cancelled ? "off" : v.released ? "0" : duration(left)} />
        <dl>
          <div>
            <dt>Owner</dt>
            <dd>{p.nameOf(v.owner)}</dd>
          </div>
          <div>
            <dt>Heir</dt>
            <dd>{p.nameOf(v.heir)}</dd>
          </div>
          <div>
            <dt>Check-in</dt>
            <dd>every {periodLabel(v.period)}</dd>
          </div>
          <div>
            <dt>Guardians</dt>
            <dd className="gdots">
              {v.guardians.map((g, i) => (
                <span key={g} className={v.handedOff[i] ? "on" : ""} title={`${p.nameOf(g)}${v.handedOff[i] ? " handed off" : ""}`}>
                  {p.nameOf(g)}
                </span>
              ))}
            </dd>
          </div>
        </dl>
      </div>

      {v.released && !v.cancelled && (
        <div className="bar-wrap" aria-label={`${v.handoffCount} of ${v.threshold} guardian handoffs`}>
          <div className="bar">
            <i style={{ width: `${Math.min(1, v.handoffCount / v.threshold) * 100}%` }} />
          </div>
          <span className="small muted">
            {Math.min(v.handoffCount, v.threshold)} of {v.threshold} guardians have handed off
          </span>
        </div>
      )}

      <div className="row">
        {isOwner && !v.released && !v.cancelled && (
          <>
            <button className="btn small primary" disabled={busy} onClick={() => run("Checking in…", () => p.backend.checkIn(p.me, v.id), "Checked in. Release date moved forward.")}>
              I'm still here
            </button>
            <button className="btn small ghost" disabled={busy} onClick={() => run("Cancelling…", () => p.backend.cancel(p.me, v.id), "Vault cancelled.")}>
              Cancel vault
            </button>
          </>
        )}
        {gIndex >= 0 && v.released && !v.cancelled && !v.handedOff[gIndex] && (
          <button
            className="btn small primary"
            disabled={busy}
            onClick={() => run("Opening your share and sealing it to the heir…", () => handOff(p.backend, p.me, v.id, myKey()), `Handed off to ${p.nameOf(v.heir)}.`)}
          >
            Hand off to heir
          </button>
        )}
        {gIndex >= 0 && !v.released && !v.cancelled && <span className="small muted">You can hand off once the owner misses a check-in.</span>}
        {gIndex >= 0 && v.handedOff[gIndex] && <span className="small muted">You have handed off your share.</span>}
        {isHeir && openable && secret === null && (
          <button
            className="btn small primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setMsg({ kind: "busy", text: "Joining the pieces and decrypting in your browser…" });
              try {
                setSecret(await openVault(p.backend, p.me, v.id, myKey()));
                p.log("Heir opened the vault");
                setMsg({ kind: "ok", text: "Vault opened on this device only." });
              } catch (e) {
                setMsg({ kind: "err", text: errText(e) });
              } finally {
                setBusy(false);
              }
            }}
          >
            Open vault
          </button>
        )}
        {isHeir && !openable && !v.cancelled && (
          <span className="small muted">{v.released ? "Waiting for two guardians to hand off." : "Opens after the owner misses a check-in and two guardians hand off."}</span>
        )}
      </div>

      {secret !== null && (
        <div className="secret">
          <div className={`secret-text ${shown ? "" : "blur"}`}>{secret}</div>
          <div className="row">
            <button className="btn small ghost" onClick={() => setShown((s) => !s)}>
              {shown ? "Hide" : "Show"}
            </button>
            <button className="btn small ghost" onClick={() => void navigator.clipboard?.writeText(secret)}>
              Copy
            </button>
          </div>
        </div>
      )}
      {msg && <Status kind={msg.kind}>{msg.text}</Status>}
    </article>
  );
}

function Ring(p: { value: number; label: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring" aria-label={`Time to release: ${p.label}`}>
      <svg width="64" height="64" viewBox="0 0 64 64">
        <defs>
          <linearGradient id="rg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffd08a" />
            <stop offset="1" stopColor="#ff6a3d" />
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r={r} stroke="rgba(243,237,228,.1)" strokeWidth="4" fill="none" />
        <circle
          cx="32"
          cy="32"
          r={r}
          stroke="url(#rg)"
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - p.value)}
          transform="rotate(-90 32 32)"
        />
      </svg>
      <span>{p.label}</span>
    </div>
  );
}

function FeedPanel(p: { feed: FeedItem[]; mode: Mode }) {
  return (
    <div className="glass panel feed-panel">
      <div className="panel-head">
        <h3>Activity</h3>
      </div>
      {p.feed.length === 0 ? (
        <p className="muted">What you do in this session appears here.</p>
      ) : (
        <ul className="feed">
          {p.feed.map((f) => (
            <li key={f.id}>
              <span>{f.text}</span>
              <span className="small muted">
                {f.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                {f.tx && p.mode === "live" && (
                  <>
                    {" · "}
                    <a href={`${EXPLORER_TX}${f.tx}`} target="_blank" rel="noreferrer">
                      tx
                    </a>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
