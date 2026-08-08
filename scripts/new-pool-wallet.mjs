// VALO — generate the fee pool wallet.
//
//   node scripts/new-pool-wallet.mjs
//
// Every trade pays its site fee into this one wallet. Splitting per-trade
// fails on small orders: a 0.01 SOL buy owes 0.000024 SOL to the burn leg,
// far under the 0.00089 SOL rent-exempt minimum, so the transfer is rejected
// and takes the whole fee with it. Pooling removes any minimum — every trade
// contributes what it owes, and the 40/40/20 happens once on the batch.
//
// This wallet only ever holds undistributed fees. Keep the key out of the
// repo. If you later automate distribution on a cron, THIS is the key to use —
// never the treasury's — so the worst case is losing whatever has pooled since
// the last run rather than the treasury itself.

import { Keypair } from "@solana/web3.js";

const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) { out = A[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b === 0) out = "1" + out; else break; }
  return out;
}

const kp = Keypair.generate();

console.log("\n  FEE POOL WALLET\n");
console.log("  address   ", kp.publicKey.toBase58());
console.log("  secret key", b58(kp.secretKey));
console.log(`
  1. Add the ADDRESS to Vercel as VALO_FEE_POOL (Production and Preview).
     Fees start pooling there on the next deploy.

  2. Save the SECRET KEY somewhere safe — a password manager, not the repo.
     It is needed to run scripts/distribute-fees.mjs.

  3. Send it ~0.01 SOL so it can pay its own network fees when distributing.

  This key is printed once and never stored. Copy it now.
`);
