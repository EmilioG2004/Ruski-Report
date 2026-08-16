import { InMemoryUserBlockRepository } from "./in-memory-user-block.repository";

const transaction = {
  id: "transaction-1",
  startedAt: "2026-07-23T12:00:00.000Z"
};

describe("InMemoryUserBlockRepository", () => {
  it("orders newest blocks first with a stable user-id tie breaker", async () => {
    const repository = new InMemoryUserBlockRepository();
    await repository.block(input("user-z", "Zulu", "2026-07-23T11:00:00.000Z"), transaction);
    await repository.block(input("user-b", "Bravo", "2026-07-23T12:00:00.000Z"), transaction);
    await repository.block(input("user-a", "Alpha", "2026-07-23T12:00:00.000Z"), transaction);

    const result = await repository.listBlockedUsers("viewer-1");

    expect(result.ok && result.value.map((user) => user.userId)).toEqual([
      "user-a",
      "user-b",
      "user-z"
    ]);
  });
});

function input(userId: string, displayName: string, createdAt: string) {
  return {
    blockerUserId: "viewer-1",
    blockedUser: { userId, displayName },
    createdAt
  };
}
