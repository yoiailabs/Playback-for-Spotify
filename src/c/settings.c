#include "settings.h"

bool long_press_mode_valid(int value) {
  return value == LP_MODE_SEEK || value == LP_MODE_VOLUME;
}

bool long_press_mode_tuple_valid(int type, unsigned length, int32_t value) {
  return (type == SETTINGS_TUPLE_INT || type == SETTINGS_TUPLE_UINT) &&
    length == 4 && long_press_mode_valid(value);
}
