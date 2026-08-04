import { ItemDef, Role } from "./types";

export class Player {
  public id: string;          // socket.id corrente
  public name: string;
  public isHost: boolean = false;
  public alive: boolean = true;
  public role: Role | null = null;

  public itemOptions: ItemDef[] = [];   // opzioni di OGGI (server-only)
  public nextItemOptions: ItemDef[] = []; // opzioni già pre-generate per DOMANI (previsione investigatore)
  public chosenItemId: string | null = null;
  public killedBy: string | null = null; // nome di chi ti ha ucciso

  public hasVotedThisRound: boolean = false;
  public disconnected: boolean = false;
  public investigatorUsedToday: boolean = false; // si blocca solo quando chiude la finestra

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name.slice(0, 20);
  }

  resetForNewDay() {
    this.itemOptions = [];
    this.chosenItemId = null;
    this.hasVotedThisRound = false;
    this.investigatorUsedToday = false;
  }

  toPublicState() {
    return {
      id: this.id,
      name: this.name,
      alive: this.alive,
      isHost: this.isHost,
    };
  }

  /** Stato segreto: SOLO per il proprietario del socket. */
  toMySecretState() {
    return {
      role: this.role,
      itemOptions: this.itemOptions,
      chosenItemId: this.chosenItemId,
      killedBy: this.killedBy,
      investigatorLocked: this.investigatorUsedToday,
    };
  }
}
