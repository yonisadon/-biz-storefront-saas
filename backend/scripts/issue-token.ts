import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';

async function main() {
  const [slug, label = 'seller'] = process.argv.slice(2);
  if (!slug) throw new Error('usage: npm run issue-token -- <slug> [label]');

  const db = new pg.Client({ connectionString: process.env.SUPERADMIN_DATABASE_URL });
  await db.connect();

  const token = randomBytes(32).toString('base64url'); // 43 chars, 256 bits
  const hash = createHash('sha256').update(token, 'utf8').digest();
  const r = await db.query(
    `INSERT INTO access_tokens (tenant_id, token_hash, label)
     SELECT id, $2, $3 FROM businesses WHERE slug = $1 RETURNING id`,
    [slug, hash, label],
  );
  await db.end();
  if (!r.rowCount) throw new Error(`no business with slug "${slug}"`);

  console.log(`Shown once, store it safely:\n${process.env.PUBLIC_BASE_URL}/manage/${token}`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
