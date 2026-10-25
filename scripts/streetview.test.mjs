import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fovForZoom, headingTo, waterPlaneY, distanceM, waterAppearance, CAMERA_HEIGHT_M } from '../web/src/streetview.ts';
test('Street View zoom maps to the panorama field of view and the water plane follows the slider under a fixed camera', () => {
  assert.equal(fovForZoom(0), 170); assert.equal(fovForZoom(1), 90); assert.equal(fovForZoom(2), 45);
  assert.equal(waterPlaneY(0), -CAMERA_HEIGHT_M); assert.equal(waterPlaneY(1.5), 1.5 - CAMERA_HEIGHT_M); assert.equal(waterPlaneY(9), 3 - CAMERA_HEIGHT_M);
  assert.equal(Math.round(headingTo({ lat: 48.0, lng: 2.0 }, { lat: 48.0, lng: 2.001 })), 90);
  assert.equal(Math.round(headingTo({ lat: 48.0, lng: 2.0 }, { lat: 47.999, lng: 2.0 })), 180);
});
test('distance to the panorama comes from the coordinates, never a zero placeholder', () => {
  assert.equal(Math.round(distanceM({ lat: 48.844929, lng: 2.369632 }, { lat: 48.844929, lng: 2.369632 })), 0);
  const d = distanceM({ lat: 48.844929, lng: 2.369632 }, { lat: 48.845229, lng: 2.369632 });
  assert.ok(Math.abs(d - 33.36) < 0.2, String(d));
});
test('water above the camera height switches to a coherent submerged state', () => {
  assert.deepEqual(waterAppearance(0), { visible: false, submerged: false, tintAlpha: 0 });
  assert.deepEqual(waterAppearance(CAMERA_HEIGHT_M - 0.01).submerged, false);
  assert.equal(waterAppearance(CAMERA_HEIGHT_M).submerged, false);
  const under = waterAppearance(CAMERA_HEIGHT_M + 0.01);
  assert.equal(under.submerged, true); assert.ok(under.tintAlpha > 0.4 && under.visible);
  assert.ok(waterAppearance(3).tintAlpha > under.tintAlpha && waterAppearance(3).tintAlpha <= 0.75);
});
