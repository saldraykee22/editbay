import type { EditbayApi } from '../../shared/api';

declare global {
  interface Window {
    editbay: EditbayApi;
  }
}

export {};
