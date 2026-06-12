import test from "node:test";
import assert from "node:assert/strict";
import { openConfirmDialog } from "../public/confirm-flow.mjs";

test("open confirm dialog stores pending action and shows modal", () => {
  const state = { pendingAction: null };
  const els = fakeConfirmElements();

  const pending = openConfirmDialog({
    state,
    els,
    endpoint: "/api/cells/lock-5g",
    token: "confirm-token",
    successMessage: "5G 锁小区请求已提交",
    title: "确认锁定 5G 小区",
    details: {
      risk: "锁小区会强制驻留在指定小区",
      expiresInMs: 60000,
      request: { goformId: "NR5G_LOCK_CELL_SET", nr5g_cell_lock: "572,504990,41,1" },
    },
  });

  assert.deepEqual(pending, {
    endpoint: "/api/cells/lock-5g",
    token: "confirm-token",
    successMessage: "5G 锁小区请求已提交",
  });
  assert.equal(state.pendingAction, pending);
  assert.equal(els.confirmTitle.textContent, "确认锁定 5G 小区");
  assert.equal(els.confirmDialog.showModalCalls, 1);
  assert.match(els.confirmPayload.textContent, /锁小区会强制驻留/);
  assert.match(els.confirmPayload.textContent, /NR5G_LOCK_CELL_SET/);
});

test("open confirm dialog closes an existing dialog before showing unlock confirmation", () => {
  const state = { pendingAction: { endpoint: "/old", token: "old", successMessage: "旧操作" } };
  const els = fakeConfirmElements({ open: true });

  openConfirmDialog({
    state,
    els,
    endpoint: "/api/cells/lock-5g",
    token: "unlock-token",
    successMessage: "5G 小区解锁请求已提交",
    title: "确认解锁 5G 小区",
    details: {
      risk: "解锁后将恢复路由器自动选小区",
      expiresInMs: 60000,
      request: { goformId: "NR5G_LOCK_CELL_SET", nr5g_cell_lock: "1,1,1,1" },
    },
  });

  assert.equal(els.confirmDialog.closeCalls, 1);
  assert.equal(els.confirmDialog.returnValue, "cancel");
  assert.equal(els.confirmDialog.showModalCalls, 1);
  assert.equal(state.pendingAction.token, "unlock-token");
  assert.equal(els.confirmTitle.textContent, "确认解锁 5G 小区");
  assert.match(els.confirmPayload.textContent, /自动选小区/);
});

function fakeConfirmElements({ open = false } = {}) {
  return {
    confirmTitle: { textContent: "" },
    confirmPayload: { textContent: "" },
    confirmDialog: {
      open,
      returnValue: "",
      closeCalls: 0,
      showModalCalls: 0,
      close(value) {
        this.open = false;
        this.returnValue = value;
        this.closeCalls += 1;
      },
      showModal() {
        this.open = true;
        this.showModalCalls += 1;
      },
    },
  };
}
