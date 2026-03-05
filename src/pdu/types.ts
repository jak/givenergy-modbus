export interface HeartbeatPdu {
  type: 'heartbeat';
  dataAdapterSerial: string;
  dataAdapterType: number;
}

export interface TransparentPdu {
  type: 'transparent';
  transparentFunctionCode: number;
  slaveAddress: number;
  inverterSerial: string;
  baseRegister: number;
  registerCount: number;
  registerValues: number[];
  error: boolean;
}

export type PduMessage = HeartbeatPdu | TransparentPdu;
