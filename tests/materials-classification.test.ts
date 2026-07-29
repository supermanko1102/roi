import test from "node:test";
import assert from "node:assert/strict";
import { classify } from "../etl/classify-materials";

test("contract brands are only collected from matching equipment contexts", () => {
  const result = classify(`
※ 衛浴設備
一、主浴廁採進口品牌（美標）馬桶加免治座蓋，次浴廁採進口品牌（美標）馬桶。
二、主臥衛浴配多功能暖風機（台達）。
※ 廚房
採 IH 電子爐（櫻花）、排油煙機（櫻花）、嵌櫃式烘碗機（林內）及廚下淨水器（3M）。
※ 電梯
採用三菱或永大、崇友電梯。
`);

  assert.deepEqual(result.bath, ["American Standard", "台達"]);
  assert.deepEqual(result.kitchen, ["櫻花", "林內", "3M"]);
  assert.equal(result.bath.includes("三菱"), false);
});
