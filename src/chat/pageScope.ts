/** A response may update a chat only while the same account, space and permission generation remain active. */
export class ChatPageScope {
  private key = "";
  private token = { active: false };

  select(ownerId: string | undefined, spaceId: string): void {
    const key = JSON.stringify([ownerId ?? null, spaceId]);
    if (this.key === key) return;
    this.token.active = false;
    this.key = key;
    this.token = { active: false };
  }

  begin(): () => boolean {
    this.token.active = false;
    this.token = { active: true };
    return this.capture();
  }

  capture(): () => boolean {
    const token = this.token;
    return () => token === this.token && token.active;
  }

  revoke(): void { this.token.active = false; }
}
