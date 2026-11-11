#include "progress.h"
#include <stdio.h>

#define MAX_DISPLAY_SECONDS (9999 * 60 + 59)

ProgressTime progress_format_time(int elapsed_sec, int total_sec,
                                  char label[PROGRESS_TIME_BUFFER_SIZE]) {
  ProgressTime time = {
    .elapsed_sec = elapsed_sec < 0 ? 0 : elapsed_sec,
    .total_sec = total_sec < 0 ? 0 : total_sec,
  };
  if (time.total_sec > 0 && time.elapsed_sec > time.total_sec) {
    time.elapsed_sec = time.total_sec;
  }

  int elapsed_display = time.elapsed_sec > MAX_DISPLAY_SECONDS
      ? MAX_DISPLAY_SECONDS : time.elapsed_sec;
  int total_display = time.total_sec > MAX_DISPLAY_SECONDS
      ? MAX_DISPLAY_SECONDS : time.total_sec;
  // At most "9999:59 / 9999:59" plus the terminator (18 bytes).
  snprintf(label, PROGRESS_TIME_BUFFER_SIZE, "%d:%02d / %d:%02d",
           elapsed_display / 60, elapsed_display % 60,
           total_display / 60, total_display % 60);
  return time;
}
