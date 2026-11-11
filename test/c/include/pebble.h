#pragma once

// Deliberately small host model for marquee tests, not a watch SDK replacement.
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef const char *GFont;
typedef struct { int16_t w, h; } GSize;
typedef struct { int16_t x, y; } GPoint;
typedef struct { GPoint origin; GSize size; } GRect;
#define GRect(x, y, w, h) ((GRect){{(x), (y)}, {(w), (h)}})
typedef int GColor;
#define GColorWhite 255
typedef enum { GTextAlignmentLeft, GTextAlignmentCenter } GTextAlignment;
typedef enum { GTextOverflowModeWordWrap, GTextOverflowModeTrailingEllipsis } GTextOverflowMode;
typedef struct GContext GContext;
typedef struct AppTimer { int unused; } AppTimer;
typedef void (*AppTimerCallback)(void *);
typedef struct Layer { GRect frame; void *data; } Layer;

AppTimer *app_timer_register(uint32_t ms, AppTimerCallback callback, void *data);
void app_timer_cancel(AppTimer *timer);

// Fixed five- or ten-pixel glyphs test overflow math independently
// of watch font metrics. Rendering and real timer scheduling are not modeled.
static inline GSize graphics_text_layout_get_content_size(
    const char *text, GFont font, GRect box, GTextOverflowMode overflow,
    GTextAlignment alignment) {
  int glyph_width = strcmp(font, "wide-font") == 0 ? 10 : 5;
  return (GSize){(int16_t)(strlen(text) * glyph_width), 10};
}
static inline Layer *layer_create_with_data(GRect frame, size_t size) {
  Layer *layer = calloc(1, sizeof(*layer));
  if (layer) {
    layer->frame = frame;
    layer->data = calloc(1, size);
    if (!layer->data) { free(layer); return NULL; }
  }
  return layer;
}
static inline void layer_destroy(Layer *layer) { free(layer->data); free(layer); }
static inline void *layer_get_data(Layer *layer) { return layer->data; }
static inline GRect layer_get_bounds(Layer *layer) { return layer->frame; }
static inline void layer_set_update_proc(Layer *layer, void (*proc)(Layer *, GContext *)) {}
static inline void layer_mark_dirty(Layer *layer) {}
static inline void graphics_context_set_text_color(GContext *ctx, GColor color) {}
static inline void graphics_draw_text(GContext *ctx, const char *text, GFont font,
    GRect box, GTextOverflowMode overflow, GTextAlignment alignment, void *attributes) {}
