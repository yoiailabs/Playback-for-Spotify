#include <assert.h>
#include <stdio.h>
#include "../../src/c/outbox_queue.h"

static void hold_until_ready(void) {
  OutboxQueue queue = {0};
  outbox_queue_command(&queue, 10);
  assert(!outbox_queue_should_send(&queue));
  assert(!outbox_queue_retry_needed(&queue));
  outbox_queue_ready(&queue, false);
  assert(outbox_queue_should_send(&queue));
  assert(queue.command == 10);
}

static void busy_coalescing_and_completion(void) {
  // Both ACK and NACK handlers complete the active dictionary and drain
  // whatever was queued meanwhile; they do not resend the old command.
  for (int nack = 0; nack <= 1; nack++) {
    OutboxQueue queue = {0};
    outbox_queue_ready(&queue, false);
    outbox_queue_command(&queue, 10);
    outbox_queue_sent(&queue);
    outbox_queue_command(&queue, 11);
    outbox_queue_command(&queue, 12);
    assert(!outbox_queue_should_send(&queue));
    assert(!outbox_queue_retry_needed(&queue));
    outbox_queue_completed(&queue);
    assert(outbox_queue_should_send(&queue));
    assert(queue.command == 12);
    outbox_queue_sent(&queue);
    outbox_queue_completed(&queue);
    assert(!outbox_queue_should_send(&queue));
    puts(nack ? "ok - NACK drains newest pending command" : "ok - ACK drains newest pending command");
  }
}

static void mode_report_piggybacks_once(void) {
  OutboxQueue queue = {0};
  outbox_queue_command(&queue, 1);
  outbox_queue_ready(&queue, true);
  assert(outbox_queue_should_send(&queue));
  assert(queue.has_command && queue.command == 1 && queue.mode_report);
  outbox_queue_sent(&queue);
  assert(!queue.has_command && !queue.mode_report);
  outbox_queue_completed(&queue);
  assert(!outbox_queue_should_send(&queue));
}

static void report_without_command_and_aplite(void) {
  OutboxQueue queue = {0};
  outbox_queue_ready(&queue, false); // Aplite has no mode report.
  assert(!outbox_queue_should_send(&queue));
  outbox_queue_ready(&queue, true);
  assert(outbox_queue_should_send(&queue));
  assert(queue.mode_report && !queue.has_command);
}

static void synchronous_failures_retry(void) {
  // A failed begin or failed send leaves every pending field intact.
  for (int send_failure = 0; send_failure <= 1; send_failure++) {
    OutboxQueue queue = {0};
    outbox_queue_ready(&queue, true);
    outbox_queue_command(&queue, 10);
    assert(outbox_queue_should_send(&queue));
    assert(outbox_queue_retry_needed(&queue));
    assert(queue.mode_report && queue.has_command && !queue.busy);
    assert(!outbox_queue_retry_needed(&queue)); // No duplicate retry timer.
    outbox_queue_command(&queue, 12);
    assert(!outbox_queue_should_send(&queue)); // Honor the backoff.
    outbox_queue_retry_due(&queue);
    assert(outbox_queue_should_send(&queue));
    assert(queue.command == 12 && queue.mode_report);
    // A second synchronous failure can schedule one new timer.
    assert(outbox_queue_retry_needed(&queue));
    assert(!outbox_queue_retry_needed(&queue));
    outbox_queue_retry_due(&queue);
    outbox_queue_sent(&queue);
    outbox_queue_completed(&queue);
    assert(!outbox_queue_should_send(&queue));
    assert(!outbox_queue_retry_needed(&queue));
    puts(send_failure ? "ok - retry after send failure" : "ok - retry after begin failure");
  }
}

static void prefetch_abort_shares_pending_dictionary(void) {
  OutboxQueue queue = {0};
  outbox_queue_ready(&queue, true);
  outbox_queue_command(&queue, 1);
  queue.prefetch_abort = true;
  outbox_queue_sent(&queue);
  assert(!queue.prefetch_abort);
  queue.prefetch_abort = true;
  assert(!outbox_queue_should_send(&queue));
  outbox_queue_completed(&queue);
  assert(outbox_queue_should_send(&queue));
  assert(queue.prefetch_abort && !queue.mode_report && !queue.has_command);
}

int main(void) {
  hold_until_ready();
  puts("ok - hold while JS is not ready");
  busy_coalescing_and_completion();
  mode_report_piggybacks_once();
  puts("ok - mode report piggybacks once on pending command");
  report_without_command_and_aplite();
  puts("ok - standalone mode report and Aplite readiness");
  synchronous_failures_retry();
  prefetch_abort_shares_pending_dictionary();
  puts("ok - prefetch abort shares serialized outbox");
  puts("8 outbox queue C tests passed");
  return 0;
}
