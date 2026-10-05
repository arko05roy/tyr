// Software WebAuthn authenticator for tests: produces real P-256 attestations ("none") and
// assertions exactly as a platform authenticator would. No browser, nothing faked.
import { createHash, createPrivateKey, createECDH, randomBytes, sign } from 'node:crypto';
import type { Hex } from 'viem';

const b64u = (b: Buffer) => b.toString('base64url');
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest();

function cborBytes(b: Buffer): Buffer {
  if (b.length < 24) return Buffer.concat([Buffer.from([0x40 + b.length]), b]);
  if (b.length < 256) return Buffer.concat([Buffer.from([0x58, b.length]), b]);
  return Buffer.concat([Buffer.from([0x59, b.length >> 8, b.length & 0xff]), b]);
}
const cborText = (s: string) => Buffer.concat([Buffer.from([0x60 + s.length]), Buffer.from(s)]);

export class SoftAuthenticator {
  readonly privateKey: Hex;
  readonly credentialId = randomBytes(16);
  private readonly x: Buffer;
  private readonly y: Buffer;
  private counter = 0;

  constructor(
    readonly rpId: string,
    readonly origin: string,
    privateKey?: Hex,
  ) {
    const ecdh = createECDH('prime256v1');
    if (privateKey) ecdh.setPrivateKey(Buffer.from(privateKey.slice(2), 'hex'));
    else ecdh.generateKeys();
    this.privateKey = `0x${ecdh.getPrivateKey().toString('hex').padStart(64, '0')}`;
    const pub = ecdh.getPublicKey(); // 0x04 ‖ x ‖ y
    this.x = pub.subarray(1, 33);
    this.y = pub.subarray(33, 65);
  }

  get publicKey(): Hex {
    return `0x04${this.x.toString('hex')}${this.y.toString('hex')}`;
  }

  private cosePublicKey(): Buffer {
    return Buffer.concat([
      Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
      this.x,
      Buffer.from([0x22, 0x58, 0x20]),
      this.y,
    ]);
  }

  private authData(flags: number, attested?: Buffer): Buffer {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(++this.counter);
    return Buffer.concat([
      sha256(this.rpId),
      Buffer.from([flags]),
      count,
      ...(attested ? [attested] : []),
    ]);
  }

  /** navigator.credentials.create() equivalent → RegistrationResponseJSON */
  create(challenge: string) {
    const clientDataJSON = Buffer.from(
      JSON.stringify({
        type: 'webauthn.create',
        challenge,
        origin: this.origin,
        crossOrigin: false,
      }),
    );
    const idLen = Buffer.from([0, this.credentialId.length]);
    const attested = Buffer.concat([
      Buffer.alloc(16),
      idLen,
      this.credentialId,
      this.cosePublicKey(),
    ]);
    const authData = this.authData(0x45, attested); // UP | UV | AT
    const attestationObject = Buffer.concat([
      Buffer.from([0xa3]),
      cborText('fmt'),
      cborText('none'),
      cborText('attStmt'),
      Buffer.from([0xa0]),
      cborText('authData'),
      cborBytes(authData),
    ]);
    const id = b64u(this.credentialId);
    return {
      id,
      rawId: id,
      type: 'public-key' as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64u(clientDataJSON),
        attestationObject: b64u(attestationObject),
        transports: ['internal' as const],
      },
    };
  }

  /** navigator.credentials.get() equivalent → AuthenticationResponseJSON */
  get(challenge: string) {
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: 'webauthn.get', challenge, origin: this.origin, crossOrigin: false }),
    );
    const authData = this.authData(0x05); // UP | UV
    const key = createPrivateKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        d: b64u(Buffer.from(this.privateKey.slice(2), 'hex')),
        x: b64u(this.x),
        y: b64u(this.y),
      },
      format: 'jwk',
    });
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), key); // DER ECDSA
    const id = b64u(this.credentialId);
    return {
      id,
      rawId: id,
      type: 'public-key' as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64u(clientDataJSON),
        authenticatorData: b64u(authData),
        signature: b64u(signature),
      },
    };
  }
}
