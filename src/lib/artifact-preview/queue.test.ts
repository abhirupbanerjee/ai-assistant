import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForSlot } from './queue';
import { QUEUE_MS, LEASE_MS, CONVERT_MS, PreviewError } from './policy';
import { assertSubmissionLease } from './provider';

test('queue waits boundedly and does not activate after cancellation', async () => {
  let now=0, attempts=0;
  await assert.rejects(waitForSlot(async()=>{attempts++;return false;},new AbortController().signal,()=>now,async ms=>{now+=ms;}),{code:'QUEUE_TIMEOUT'});
  assert.equal(now,QUEUE_MS); assert.equal(attempts,75);
  const abort=new AbortController(); abort.abort(); attempts=0;
  await assert.rejects(waitForSlot(async()=>{attempts++;return true;},abort.signal),{code:'REQUEST_CANCELLED'});
  assert.equal(attempts,0); assert.ok(LEASE_MS>CONVERT_MS+QUEUE_MS);
});
test('late DB grants and repeated lock contention do not bypass deadline', async () => {
  let now=0;
  await assert.rejects(waitForSlot(async()=>{now=QUEUE_MS;return true;},new AbortController().signal,()=>now,async()=>{}),{code:'QUEUE_TIMEOUT'});
  now=0;
  await assert.rejects(waitForSlot(async()=>{throw new PreviewError('PREVIEW_BUSY',409);},new AbortController().signal,()=>now,async ms=>{now+=ms;}),{code:'QUEUE_TIMEOUT'});
});
test('submission requires a finite lease covering provider lifetime and grace', () => {
  assert.doesNotThrow(()=>assertSubmissionLease(1000+LEASE_MS,1000));
  for(const lease of [NaN,Infinity,999,1000+CONVERT_MS])assert.throws(()=>assertSubmissionLease(lease,1000));
});
test('mock database grant is single-use and failures are not automatically retried', async () => {
  let now=0, attempts=0;
  await waitForSlot(async()=>++attempts===3,new AbortController().signal,()=>now,async ms=>{now+=ms;});
  assert.equal(attempts,3); assert.equal(now,400);
  attempts=0;
  await assert.rejects(waitForSlot(async()=>{attempts++;throw new Error('lost reservation');},new AbortController().signal));
  assert.equal(attempts,1);
});
