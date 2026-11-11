#include "outbox_queue.h"

void outbox_queue_ready(OutboxQueue *queue, bool report_mode) {
  queue->ready = true;
  queue->mode_report = queue->mode_report || report_mode;
}

void outbox_queue_command(OutboxQueue *queue, int command) {
  queue->command = command;
  queue->has_command = true;
}

bool outbox_queue_should_send(const OutboxQueue *queue) {
  return queue->ready && !queue->busy && !queue->retry_pending &&
    (queue->has_command || queue->mode_report || queue->prefetch_abort);
}

void outbox_queue_sent(OutboxQueue *queue) {
  queue->busy = true;
  queue->has_command = false;
  queue->mode_report = false;
  queue->prefetch_abort = false;
}

void outbox_queue_completed(OutboxQueue *queue) {
  queue->busy = false;
}

bool outbox_queue_retry_needed(OutboxQueue *queue) {
  if (!outbox_queue_should_send(queue)) return false;
  queue->retry_pending = true;
  return true;
}

void outbox_queue_retry_due(OutboxQueue *queue) {
  queue->retry_pending = false;
}
