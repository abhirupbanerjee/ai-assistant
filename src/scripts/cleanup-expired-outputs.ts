#!/usr/bin/env npx ts-node
/**
 * Expired Outputs Cleanup Script
 *
 * Removes expired thread outputs (documents, podcasts, images, etc.) from disk and database.
 * This script should be run periodically via cron to clean up storage.
 *
 * Usage:
 *   npx ts-node src/scripts/cleanup-expired-outputs.ts
 *   npx ts-node src/scripts/cleanup-expired-outputs.ts --dry-run
 *   npx ts-node src/scripts/cleanup-expired-outputs.ts --verbose
 *
 * Cron example (daily at 3am):
 *   0 3 * * * cd /path/to/policy-bot && npx ts-node src/scripts/cleanup-expired-outputs.ts >> /var/log/cleanup.log 2>&1
 */

import { config } from 'dotenv';
config(); // Load .env file

import { cleanupExpiredDocuments, getExpiredDocuments } from '../lib/docgen/document-generator';

interface CleanupOptions {
  dryRun: boolean;
  verbose: boolean;
}

interface CleanupResult {
  totalExpired: number;
  deleted: number;
  errors: string[];
}

async function runCleanup(options: CleanupOptions): Promise<CleanupResult> {
  const result: CleanupResult = {
    totalExpired: 0,
    deleted: 0,
    errors: [],
  };

  try {
    // Get expired documents first (for dry-run and verbose output)
    const expired = await getExpiredDocuments();
    result.totalExpired = expired.length;

    if (expired.length === 0) {
      console.log('✅ No expired outputs found');
      return result;
    }

    console.log(`📋 Found ${expired.length} expired output(s)\n`);

    if (options.verbose || options.dryRun) {
      console.log('Expired outputs:');
      for (const doc of expired) {
        const expiredAt = doc.expiresAt ? new Date(doc.expiresAt).toISOString() : 'unknown';
        const fileType = doc.fileType.toUpperCase();
        console.log(`  - [${doc.id}] ${doc.filename} (${fileType}, expired: ${expiredAt})`);
      }
      console.log();
    }

    if (options.dryRun) {
      console.log('🔍 DRY RUN MODE - No files will be deleted\n');
      return result;
    }

    // Run the cleanup
    console.log('🗑️  Cleaning up expired outputs...\n');
    result.deleted = await cleanupExpiredDocuments();

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    result.errors.push(errorMessage);
    console.error('❌ Error during cleanup:', errorMessage);
    return result;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const options: CleanupOptions = {
    dryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose'),
  };

  console.log('='.repeat(60));
  console.log('Expired Outputs Cleanup Script');
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log('='.repeat(60) + '\n');

  const result = await runCleanup(options);

  console.log('='.repeat(60));
  console.log('📊 CLEANUP SUMMARY');
  console.log('='.repeat(60));
  console.log(`   Total expired: ${result.totalExpired}`);
  console.log(`   Deleted: ${result.deleted}`);
  if (result.errors.length > 0) {
    console.log(`   Errors: ${result.errors.length}`);
    for (const err of result.errors) {
      console.log(`     - ${err}`);
    }
  }
  console.log(`   Completed at: ${new Date().toISOString()}`);
  console.log('='.repeat(60) + '\n');

  if (result.errors.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
