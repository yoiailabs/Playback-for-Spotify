#pragma once
#include <stdbool.h>

// Wire values and persist key 43: 0 = seek, 1 = volume.
typedef enum {
  LP_MODE_SEEK = 0,
  LP_MODE_VOLUME = 1
} LongPressMode;

bool long_press_mode_valid(int value);
