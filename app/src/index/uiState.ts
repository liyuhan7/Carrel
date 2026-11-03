// Panel visibility for the unified search surface. UI-only state, never
// persisted and never part of the content model.

import { create } from 'zustand'

interface IndexUiState {
  searchOpen: boolean
  openSearch: () => void
  closeSearch: () => void
}

export const useIndexUi = create<IndexUiState>((set) => ({
  searchOpen: false,
  openSearch: () => set({ searchOpen: true }),
  closeSearch: () => set({ searchOpen: false })
}))
