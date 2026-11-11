#pragma once
#include <stdbool.h>

// One pending command, plus small flags that can share its dictionary.
// Context text and the SDK retry timer stay in comm.c.
typedef struct {
  int command;
  bool has_command;
  bool ready;
  bool busy;
  bool mode_report;
  bool prefetch_abort;
  bool retry_pending;
} OutboxQueue;

void outbox_queue_ready(OutboxQueue *queue, bool report_mode);
void outbox_queue_command(OutboxQueue *queue, int command);
bool outbox_queue_should_send(const OutboxQueue *queue);
void outbox_queue_sent(OutboxQueue *queue);
void outbox_queue_completed(OutboxQueue *queue);
// True only for the first synchronous failure needing a retry timer.
bool outbox_queue_retry_needed(OutboxQueue *queue);
void outbox_queue_retry_due(OutboxQueue *queue);
