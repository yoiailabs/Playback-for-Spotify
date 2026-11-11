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
  unsigned cases = 0;
  for (int type = -1; type <= 4; type++) {
    const unsigned lengths[] = {0, 1, 2, 3, 4, 5, UINT_MAX};
    const int32_t values[] = {INT32_MIN, -1, 0, 1, 2, INT32_MAX};
    for (unsigned l = 0; l < sizeof(lengths) / sizeof(lengths[0]); l++) {
      for (unsigned v = 0; v < sizeof(values) / sizeof(values[0]); v++) {
        bool expected = (type == SETTINGS_TUPLE_INT || type == SETTINGS_TUPLE_UINT) &&
          lengths[l] == 4 && (values[v] == 0 || values[v] == 1);
        assert(long_press_mode_tuple_valid(type, lengths[l], values[v]) == expected);
        cases++;
      }
    }
  }
  printf("ok - long-press tuple type/length/value validation (%u cases)\n", cases);
  return 0;
}
