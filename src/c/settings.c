#include "settings.h"

bool long_press_mode_valid(int value) {
  return value == LP_MODE_SEEK || value == LP_MODE_VOLUME;
}
