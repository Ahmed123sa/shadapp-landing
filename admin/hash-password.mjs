#!/usr/bin/env node
// Prints the value to put in .env as ADMIN_PASSWORD_HASH.
//   node admin/hash-password.mjs "your password"
import { hashPassword } from './lib/auth.mjs';
const pw = process.argv[2];
if (!pw || pw.length < 10) { console.error('Usage: node admin/hash-password.mjs "<password of at least 10 characters>"'); process.exit(1); }
console.log('ADMIN_PASSWORD_HASH=' + await hashPassword(pw));
