import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { GET as points } from "../src/app/api/points/route";
import { GET as rentals } from "../src/app/api/rentals/route";
import { GET as projectDetail } from "../src/app/api/project-detail/route";

test("map APIs reject invalid bbox without touching the database", async () => {
  const pointResponse = await points(new NextRequest("http://localhost/api/points?bbox=122,24,121,25"));
  assert.equal(pointResponse.status, 400);
  const rentalResponse = await rentals(new NextRequest("http://localhost/api/rentals?bbox=120,20,124,25"));
  assert.equal(rentalResponse.status, 400);
});

test("project detail rejects unsupported city", async () => {
  const response = await projectDetail(new NextRequest(
    "http://localhost/api/project-detail?city=不存在市&district=中壢區&name=測試",
  ));
  assert.equal(response.status, 400);
});
