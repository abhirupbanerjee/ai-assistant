import test from 'node:test';
import assert from 'node:assert/strict';
import { integrationDatabaseUrl } from './integration-config';

test('DB suite is opt-in and cannot default to the application database',()=>{
  assert.equal(integrationDatabaseUrl({DATABASE_URL:'postgres://localhost/production'}),null);
  assert.throws(()=>integrationDatabaseUrl({ARTIFACT_PREVIEW_DB_TEST:'true',DATABASE_URL:'postgres://localhost/production'}));
  for(const url of ['postgres://remote/artifact_preview_test','postgres://localhost/production','postgres://localhost/artifact_preview_test?options=x','file:///artifact_preview_test']) {
    assert.throws(()=>integrationDatabaseUrl({ARTIFACT_PREVIEW_DB_TEST:'true',ARTIFACT_PREVIEW_TEST_DATABASE_URL:url}));
  }
  const url='postgres://localhost/artifact_preview_test_ci';
  assert.equal(integrationDatabaseUrl({ARTIFACT_PREVIEW_DB_TEST:'true',ARTIFACT_PREVIEW_TEST_DATABASE_URL:url}),url);
  assert.throws(()=>integrationDatabaseUrl({ARTIFACT_PREVIEW_DB_TEST:'true',ARTIFACT_PREVIEW_TEST_DATABASE_URL:url,DATABASE_URL:url}));
  assert.throws(()=>integrationDatabaseUrl({ARTIFACT_PREVIEW_DB_TEST:'true',ARTIFACT_PREVIEW_TEST_DATABASE_URL:url,DATABASE_URL:'postgresql://other-user@127.0.0.1:5432/artifact_preview_test_ci'}));
});
