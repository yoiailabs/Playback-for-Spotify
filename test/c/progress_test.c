#include <assert.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>
#include "../../src/c/progress.h"

static void clamping_and_display_limits(void) {
  const struct {
    int elapsed, total;
    int expected_elapsed, expected_total;
    const char *label;
  } cases[] = {
    {0, 0, 0, 0, "0:00 / 0:00"},
    {5, 125, 5, 125, "0:05 / 2:05"},
    {59, 3600, 59, 3600, "0:59 / 60:00"},
    {60, 3600, 60, 3600, "1:00 / 60:00"},
    {3601, 7200, 3601, 7200, "60:01 / 120:00"},
    {-1, 125, 0, 125, "0:00 / 2:05"},
    {126, 125, 125, 125, "2:05 / 2:05"},
    {61, 0, 61, 0, "1:01 / 0:00"},
    {61, -1, 61, 0, "1:01 / 0:00"},
    {INT_MIN, INT_MIN, 0, 0, "0:00 / 0:00"},
    {INT_MIN, INT_MAX, 0, INT_MAX, "0:00 / 9999:59"},
    {INT_MAX, 125, 125, 125, "2:05 / 2:05"},
    {INT_MAX, 0, INT_MAX, 0, "9999:59 / 0:00"},
    {INT_MAX, INT_MAX, INT_MAX, INT_MAX, "9999:59 / 9999:59"},
    {599998, 599999, 599998, 599999, "9999:58 / 9999:59"},
    {600000, 600000, 600000, 600000, "9999:59 / 9999:59"},
  };
  for (unsigned i = 0; i < sizeof(cases) / sizeof(cases[0]); i++) {
    char label[PROGRESS_TIME_BUFFER_SIZE];
    ProgressTime time = progress_format_time(cases[i].elapsed, cases[i].total, label);
    assert(time.elapsed_sec == cases[i].expected_elapsed);
    assert(time.total_sec == cases[i].expected_total);
    assert(strcmp(label, cases[i].label) == 0);
  }
}

static void normal_labels_match_original_format(void) {
  // Exercise every second and minute boundary in a two-hour track.
  for (int elapsed = 0; elapsed <= 7200; elapsed++) {
    char label[PROGRESS_TIME_BUFFER_SIZE], original[PROGRESS_TIME_BUFFER_SIZE];
    ProgressTime time = progress_format_time(elapsed, 7200, label);
    snprintf(original, sizeof(original), "%d:%02d / %d:%02d",
             elapsed / 60, elapsed % 60, 7200 / 60, 7200 % 60);
    assert(strcmp(label, original) == 0);
    assert(time.elapsed_sec == elapsed && time.total_sec == 7200);
  }
}

int main(void) {
  clamping_and_display_limits();
  puts("ok - clamping_and_display_limits (16 cases)");
  normal_labels_match_original_format();
  puts("ok - normal_labels_match_original_format (7201 labels)");
  puts("2 progress C tests passed");
  return 0;
}
