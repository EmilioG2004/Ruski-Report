import { AppError } from "../../errors";
import { AdminTournamentDetailResponse } from "../tournament-setup";
import {
  MAXIMUM_ADMIN_WEB_SETUP_FORM_FIELDS,
  calculateAdminSetupFormFieldCount,
  parseCreateTournamentForm,
  parsePublishForm,
  parseRecoveryForm,
  parseSetupForm,
  parseSignInForm
} from "./admin-web.form";

describe("administrator web flat forms", () => {
  it("rejects duplicate and unexpected authentication fields", () => {
    expect(() => parseSignInForm({
      _csrf: "csrf",
      loginName: ["operator", "attacker"],
      password: "password"
    })).toThrow(AppError);
    expect(() => parseSignInForm({
      _csrf: "csrf",
      loginName: "operator",
      password: "password",
      role: "superuser"
    })).toThrow("Unexpected form field");
  });

  it("accepts only flat single-value recovery credentials", () => {
    expect(parseRecoveryForm({
      _csrf: "csrf",
      token: "recovery-token",
      password: "new-password"
    })).toEqual({
      csrf: "csrf",
      token: "recovery-token",
      password: "new-password"
    });
    expect(() => parseRecoveryForm({
      _csrf: "csrf",
      token: ["first", "second"],
      password: "new-password"
    })).toThrow("exactly once");
  });

  it("maps the built-in and advanced creation forms", () => {
    expect(parseCreateTournamentForm({
      _csrf: "csrf",
      name: "Main Tournament",
      year: "2027",
      "configuration.kind": "preset",
      "configuration.value.teamCount": "32",
      "configuration.value.podCount": "8",
      "configuration.value.podSize": "4",
      "configuration.value.playersPerTeam": "2",
      "configuration.value.gamesPerPair": "1",
      "configuration.value.qualifiersPerPod": "2",
      "configuration.value.bracketSize": "16"
    }).request.configuration).toEqual({
      kind: "preset",
      presetId: "ruski-main-32-team"
    });

    const advanced = parseCreateTournamentForm({
      _csrf: "csrf",
      name: "Small Tournament",
      year: "2027",
      "configuration.kind": "advanced",
      "configuration.value.teamCount": "8",
      "configuration.value.podCount": "2",
      "configuration.value.podSize": "4",
      "configuration.value.playersPerTeam": "2",
      "configuration.value.gamesPerPair": "1",
      "configuration.value.qualifiersPerPod": "2",
      "configuration.value.bracketSize": "4",
      "configuration.value.allowByes": "true"
    }).request.configuration;
    expect(advanced).toMatchObject({
      kind: "advanced",
      value: { podSizes: [4, 4], allowByes: true }
    });
    expect(() => parseCreateTournamentForm({
      _csrf: "csrf",
      name: "Unsafe Tournament",
      year: "2027",
      "configuration.kind": "advanced",
      "configuration.value.teamCount": "32",
      "configuration.value.podCount": "9007199254740991",
      "configuration.value.podSize": "4",
      "configuration.value.playersPerTeam": "2",
      "configuration.value.gamesPerPair": "1",
      "configuration.value.qualifiersPerPod": "2",
      "configuration.value.bracketSize": "16"
    })).toThrow("between 1 and 32");
  });

  it("calculates the URL-encoded field requirement at supported maxima", () => {
    expect(calculateAdminSetupFormFieldCount(1, 1, 1)).toBe(13);
    expect(calculateAdminSetupFormFieldCount(32, 8, 2)).toBe(466);
    expect(MAXIMUM_ADMIN_WEB_SETUP_FORM_FIELDS).toBe(5_698);
  });

  it("maps every expected setup slot and rejects duplicate setup values", () => {
    const detail = tournamentDetail();
    const body = {
      _csrf: "csrf",
      expectedRowVersion: "1",
      "pods.0.id": POD_ID,
      "pods.0.name": "Pod One",
      "teams.0.id": "",
      "teams.0.name": "Team One",
      "teams.0.podId": POD_ID,
      "teams.0.initialSeed": "1",
      "teams.0.players.0.id": "",
      "teams.0.players.0.displayName": "Player One",
      "teams.0.players.0.firstName": "",
      "teams.0.players.0.lastName": "",
      "teams.0.players.0.preferredName": ""
    };
    expect(parseSetupForm(body, detail).request).toEqual({
      expectedRowVersion: 1,
      pods: [{ id: POD_ID, name: "Pod One" }],
      teams: [{
        name: "Team One",
        podId: POD_ID,
        initialSeed: 1,
        players: [{ displayName: "Player One" }]
      }]
    });
    expect(() => parseSetupForm({
      ...body,
      "teams.0.name": ["Team One", "Team Two"]
    }, detail)).toThrow("exactly once");
  });

  it("omits blank team and player rows so an incomplete draft can be saved", () => {
    const detail = tournamentDetail();
    const blank = {
      _csrf: "csrf",
      expectedRowVersion: "1",
      "pods.0.id": POD_ID,
      "pods.0.name": "Pod One",
      "teams.0.id": "",
      "teams.0.name": "",
      "teams.0.podId": POD_ID,
      "teams.0.initialSeed": "1",
      "teams.0.players.0.id": "",
      "teams.0.players.0.displayName": "",
      "teams.0.players.0.firstName": "",
      "teams.0.players.0.lastName": "",
      "teams.0.players.0.preferredName": ""
    };
    expect(parseSetupForm(blank, detail).request.teams).toEqual([]);

    expect(parseSetupForm({
      ...blank,
      "teams.0.name": "Team One"
    }, detail).request.teams).toEqual([{
      name: "Team One",
      podId: POD_ID,
      initialSeed: 1,
      players: []
    }]);
  });

  it("accepts only a strict publication confirmation", () => {
    expect(parsePublishForm({
      _csrf: "csrf",
      expectedRowVersion: "2",
      previewDigest: "a".repeat(64),
      visibility: "public"
    }).request).toEqual({
      expectedRowVersion: 2,
      previewDigest: "a".repeat(64),
      visibility: "public"
    });
    expect(() => parsePublishForm({
      _csrf: "csrf",
      expectedRowVersion: "2",
      previewDigest: "a".repeat(64),
      visibility: "public",
      matches: "client-controlled"
    })).toThrow("Unexpected form field");
  });
});

const TOURNAMENT_ID = "00000000-0000-4000-8000-000000000001";
const POD_ID = "00000000-0000-4000-8000-000000000002";

function tournamentDetail(): AdminTournamentDetailResponse {
  return {
    tournament: {
      id: TOURNAMENT_ID,
      publicKey: TOURNAMENT_ID,
      gameType: "ruski",
      year: 2027,
      name: "Tournament",
      lifecycle: "draft_setup",
      visibility: "private",
      rowVersion: 1,
      setupPublishedAt: null,
      createdAt: "2027-01-01T00:00:00.000Z",
      updatedAt: "2027-01-01T00:00:00.000Z"
    },
    configuration: {
      formatVersion: 1,
      formatType: "pod_and_single_elimination",
      teamCount: 1,
      podCount: 1,
      podSizes: [1],
      playersPerTeam: 1,
      gamesPerPair: 1,
      qualifiersPerPod: 1,
      bracketSize: 2,
      allowByes: true,
      standingsRules: [
        "record",
        "cupDifferential",
        "teamShootingPercentage",
        "administratorResolution"
      ]
    },
    pods: [{ id: POD_ID, name: "Pod 1", sequence: 1 }],
    teams: [],
    validation: { publishable: false, issues: [] }
  };
}
