export function openConfirmDialog({ state, els, endpoint, token, successMessage, title, details, thermalTarget }) {
  if (els.confirmDialog.open) els.confirmDialog.close("cancel");
  state.pendingAction = {
    endpoint,
    token,
    successMessage,
  };
  if (thermalTarget !== undefined) state.pendingAction.thermalTarget = thermalTarget;
  els.confirmTitle.textContent = title;
  els.confirmPayload.textContent = JSON.stringify(details, null, 2);
  els.confirmDialog.showModal();
  return state.pendingAction;
}
