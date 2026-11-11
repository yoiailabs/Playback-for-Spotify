#pragma once

#define PROGRESS_TIME_BUFFER_SIZE 24

typedef struct {
  int elapsed_sec;
  int total_sec;
} ProgressTime;

// Return non-negative times, limiting elapsed to total when total is known.
// Format those times as m:ss / m:ss, saturating each display at 9999:59.
ProgressTime progress_format_time(int elapsed_sec, int total_sec,
                                  char label[PROGRESS_TIME_BUFFER_SIZE]);
