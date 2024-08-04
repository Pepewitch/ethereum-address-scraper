import { makeAutoObservable } from "mobx";
import { Chain } from "./ChainUtils";

export enum AddressType {
  EOA = "EOA",
  TOKEN = "TOKEN",
  UNKNOWN_CONTRACT = "UNKNOWN CONTRACT",
  UNKNOWN = "UNKNOWN",
}

export interface AddressInfo {
  type: AddressType;
  symbol?: string;
  error?: boolean;
}

export class AddressStore {
  addressInfo: Record<string, AddressInfo> = {};

  constructor() {
    makeAutoObservable(this);
  }

  setAddressInfo(address: string, chain: Chain, info: AddressInfo) {
    this.addressInfo[`${address}-${chain}`] = info;
  }

  getAddressInfo(address: string, chain: Chain): AddressInfo {
    return (
      this.addressInfo[`${address}-${chain}`] || { type: "" as AddressType }
    );
  }
}

export const addressStore = new AddressStore();
