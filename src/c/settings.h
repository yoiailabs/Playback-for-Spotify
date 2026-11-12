#pragma once
#include <stdbool.h>
#include <stdint.h>

// Wire values and persist key 43: 0 = seek, 1 = volume.
typedef enum {
  LP_MODE_SEEK = 0,
  LP_MODE_VOLUME = 1
} LongPressMode;

bool long_press_mode_valid(int value);

// Pebble dictionary wire types, kept independent of pebble.h for host tests.
enum {
  SETTINGS_TUPLE_UINT = 2,
  SETTINGS_TUPLE_INT = 3
};

bool long_press_mode_tuple_valid(int type, unsigned length, int32_t value);
