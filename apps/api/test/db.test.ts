import { describe, expect, it } from "vitest";
import { databaseNameIn } from "../src/db";

describe("databaseNameIn", () => {
  it.each([
    ["mongodb+srv://user:pw@cluster0.abc.mongodb.net/prepkit?retryWrites=true", "prepkit"],
    ["mongodb://localhost:27017/interview-kits", "interview-kits"],
    ["mongodb://a:b@h1:27017,h2:27017/my%20db?replicaSet=rs0", "my db"],
  ])("reads the database from %s", (uri, expected) => {
    expect(databaseNameIn(uri)).toBe(expected);
  });

  it.each([
    "mongodb+srv://user:pw@cluster0.abc.mongodb.net",
    "mongodb+srv://user:pw@cluster0.abc.mongodb.net/",
    "mongodb+srv://user:pw@cluster0.abc.mongodb.net/?retryWrites=true&w=majority",
  ])("finds none in %s, so the default is used instead of the driver's \"test\"", (uri) => {
    expect(databaseNameIn(uri)).toBeUndefined();
  });
});
