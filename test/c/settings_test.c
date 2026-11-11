#include <assert.h>
#include <limits.h>
#include <stdio.h>
#include "../../src/c/settings.h"

int main(void) {
  // Keep persisted values and the AppMessage contract stable.
  assert(LP_MODE_SEEK == 0);
  assert(LP_MODE_VOLUME == 1);
  assert(long_press_mode_valid(0));
  assert(long_press_mode_valid(1));
  const int invalid[] = {INT_MIN, -1, 2, 43, 160, INT_MAX};
  for (unsigned i = 0; i < sizeof(invalid) / sizeof(invalid[0]); i++) {
    assert(!long_press_mode_valid(invalid[i]));
  }
  puts("ok - long-press wire/persist values and invalid settings (8 cases)");
  return 0;
}
