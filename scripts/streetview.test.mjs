import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fovForZoom, headingTo, waterPlaneY, CAMERA_HEIGHT_M } from '../web/src/streetview.ts';
test('Street View zoom maps to the panorama field of view and the water plane follows the slider under a fixed camera', () => {
  assert.equal(fovForZoom(0), 170); assert.equal(fovForZoom(1), 90); assert.equal(fovForZoom(2), 45);
  assert.equal(waterPlaneY(0), -CAMERA_HEIGHT_M); assert.equal(waterPlaneY(1.5), 1.5 - CAMERA_HEIGHT_M); assert.equal(waterPlaneY(9), 3 - CAMERA_HEIGHT_M);
  assert.equal(Math.round(headingTo({ lat: 48.0, lng: 2.0 }, { lat: 48.0, lng: 2.001 })), 90);
  assert.equal(Math.round(headingTo({ lat: 48.0, lng: 2.0 }, { lat: 47.999, lng: 2.0 })), 180);
});
