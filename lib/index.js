"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var fs_1 = __importDefault(require("fs"));
var blacklistedStrings = ['[do-not-merge]', '[dnl]', '[wip]'];
var autoapprovalBotLogin = 'autoapproval[bot]';
var agentNameIndicators = ['devin', 'cursor', 'claude', 'codex'];
var agentBranchPrefixes = agentNameIndicators.map(function (name) { return "".concat(name, "/"); });
var requiredApprovalsForAgentPr = 2;
var changesRequestedReviewState = 'CHANGES_REQUESTED';
var approvedReviewState = 'APPROVED';
module.exports = function (app) {
    app.on(['pull_request.opened', 'pull_request.reopened', 'pull_request.labeled', 'pull_request.edited', 'pull_request_review'], function (context) { return __awaiter(void 0, void 0, void 0, function () {
        var pr, config, prTitle, blacklistedInTitle, prLabels, blacklistedLabels, prParamsForReviews, allReviewsResponse, allReviews, latestReviewsByUser, isAgentGenerated, reviewerApprovals, needsAgentReviewBlock, hasAnyAutoapprovalReview, hasAnyAutoapprovalApproval, latestAutoapprovalReviewState, reason, shouldApproveWhileBlocked, shouldApproveNormally;
        var _a;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    context.log('Repo: %s', context.payload.repository.full_name);
                    pr = context.payload.pull_request;
                    context.log('PR: %s', pr.html_url);
                    context.log('Action: %s', context.payload.action);
                    // initialize default outputs for the GitHub Action
                    setActionOutput('approved', 'false');
                    setActionOutput('auto_approve_reason', '');
                    setActionOutput('pr_author', pr.user.login || '');
                    // NOTE(dabrady) When a PR is first opened, it can fire several different kinds of events if the author e.g. requests
                    // reviewers or adds labels during creation. This triggers parallel runs of our GitHub App, so we need to filter out
                    // those simultaneous events and focus just on the re/open event in this scenario.
                    //
                    // These simultaneous events contain the same pull request data in their payloads, and specify the 'updated at'
                    // timestamp to be the same as the 'created at' timestamp for the pull request. We can use this to distinguish events
                    // that are fired during creation from events fired later on.
                    if (!['opened', 'reopened'].includes(context.payload.action) && pr.created_at === pr.updated_at) {
                        context.log('Ignoring additional creation event: %s', context.payload.action);
                        return [2 /*return*/];
                    }
                    return [4 /*yield*/, context.config('autoapproval.yml')];
                case 1:
                    config = _b.sent();
                    context.log(config, '\n\nLoaded config');
                    prTitle = (pr.title || '').toLowerCase();
                    blacklistedInTitle = blacklistedStrings.filter(function (s) { return prTitle.toLowerCase().includes("".concat(s.toLowerCase())); });
                    if (blacklistedInTitle.length > 0) {
                        context.log('PR title contains blacklisted term(s): %s', blacklistedInTitle);
                        return [2 /*return*/];
                    }
                    prLabels = pr.labels.map(function (label) { return label.name.toLowerCase(); });
                    blacklistedLabels = blacklistedStrings
                        .filter(function (blacklistedLabel) { return prLabels.includes(blacklistedLabel); });
                    // if PR contains any black listed labels, do not proceed further
                    if (blacklistedLabels.length > 0) {
                        context.log('PR black listed from approving: %s', blacklistedLabels);
                        return [2 /*return*/];
                    }
                    prParamsForReviews = context.pullRequest();
                    return [4 /*yield*/, context.octokit.pulls.listReviews(prParamsForReviews)];
                case 2:
                    allReviewsResponse = _b.sent();
                    allReviews = allReviewsResponse.data;
                    latestReviewsByUser = getLatestReviewsByUser(allReviews);
                    return [4 /*yield*/, isAgentGeneratedPullRequest(context, pr)];
                case 3:
                    isAgentGenerated = _b.sent();
                    reviewerApprovals = countNonBotApprovalsExcludingAutoapproval(latestReviewsByUser);
                    needsAgentReviewBlock = isAgentGenerated && reviewerApprovals < requiredApprovalsForAgentPr;
                    hasAnyAutoapprovalReview = allReviews.some(function (review) { var _a; return ((_a = review === null || review === void 0 ? void 0 : review.user) === null || _a === void 0 ? void 0 : _a.login) === autoapprovalBotLogin; });
                    hasAnyAutoapprovalApproval = allReviews.some(function (review) {
                        var _a;
                        return ((_a = review === null || review === void 0 ? void 0 : review.user) === null || _a === void 0 ? void 0 : _a.login) === autoapprovalBotLogin && ((review === null || review === void 0 ? void 0 : review.state) || '').toUpperCase() === approvedReviewState;
                    });
                    latestAutoapprovalReviewState = (((_a = latestReviewsByUser.get(autoapprovalBotLogin)) === null || _a === void 0 ? void 0 : _a.state) || '').toUpperCase();
                    reason = extractAutoApproveReason(pr.body || '');
                    if (!!reason) return [3 /*break*/, 4];
                    context.log('Missing required "auto-approve reason: <text>" in PR description. Skipping approval.');
                    return [3 /*break*/, 9];
                case 4:
                    shouldApproveWhileBlocked = needsAgentReviewBlock && !hasAnyAutoapprovalApproval;
                    shouldApproveNormally = !needsAgentReviewBlock && (latestAutoapprovalReviewState !== approvedReviewState || context.payload.action === 'dismissed');
                    if (!(shouldApproveWhileBlocked || shouldApproveNormally)) return [3 /*break*/, 8];
                    return [4 /*yield*/, approvePullRequest(context)];
                case 5:
                    _b.sent();
                    latestAutoapprovalReviewState = approvedReviewState;
                    if (!!hasAnyAutoapprovalReview) return [3 /*break*/, 7];
                    return [4 /*yield*/, applyLabels(context, ['auto_approved'])];
                case 6:
                    _b.sent();
                    _b.label = 7;
                case 7:
                    setActionOutput('approved', 'true');
                    setActionOutput('auto_approve_reason', reason);
                    if (context.payload.action === 'dismissed') {
                        context.log('Review was dismissed, approve again');
                    }
                    else {
                        context.log('PR approved');
                    }
                    return [3 /*break*/, 9];
                case 8:
                    context.log('PR already has an active autoapproval approval review');
                    _b.label = 9;
                case 9:
                    if (!needsAgentReviewBlock) return [3 /*break*/, 12];
                    if (!(latestAutoapprovalReviewState !== changesRequestedReviewState)) return [3 /*break*/, 11];
                    return [4 /*yield*/, requestChangesOnPullRequest(context, reviewerApprovals)];
                case 10:
                    _b.sent();
                    latestAutoapprovalReviewState = changesRequestedReviewState;
                    _b.label = 11;
                case 11:
                    context.log('Agent-generated PR is blocked: %d/%d required non-bot approvals from other reviewers.', reviewerApprovals, requiredApprovalsForAgentPr);
                    return [3 /*break*/, 13];
                case 12:
                    if (isAgentGenerated) {
                        context.log('Agent-generated PR has enough non-bot approvals from other reviewers: %d/%d.', reviewerApprovals, requiredApprovalsForAgentPr);
                    }
                    _b.label = 13;
                case 13: return [2 /*return*/];
            }
        });
    }); });
};
function approvePullRequest(context) {
    return __awaiter(this, void 0, void 0, function () {
        var prParams;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    prParams = context.pullRequest({ event: 'APPROVE', body: 'Approved :+1:' });
                    return [4 /*yield*/, context.octokit.pulls.createReview(prParams)];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
function requestChangesOnPullRequest(context, reviewerApprovals) {
    return __awaiter(this, void 0, void 0, function () {
        var body, prParams;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    body = "This PR appears to be generated by a coding agent. It requires ".concat(requiredApprovalsForAgentPr, " non-bot approvals from other reviewers before merge. Current non-bot approvals: ").concat(reviewerApprovals, ".");
                    prParams = context.pullRequest({ event: 'REQUEST_CHANGES', body: body });
                    return [4 /*yield*/, context.octokit.pulls.createReview(prParams)];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
function applyLabels(context, labels) {
    return __awaiter(this, void 0, void 0, function () {
        var labelsParam;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!(labels.length > 0)) return [3 /*break*/, 2];
                    labelsParam = context.issue({ labels: labels });
                    return [4 /*yield*/, context.octokit.issues.addLabels(labelsParam)];
                case 1:
                    _a.sent();
                    _a.label = 2;
                case 2: return [2 /*return*/];
            }
        });
    });
}
function extractAutoApproveReason(body) {
    var lines = body.split(/\r?\n/);
    for (var _i = 0, lines_1 = lines; _i < lines_1.length; _i++) {
        var line = lines_1[_i];
        var match = line.match(/^auto-approve reason:\s*(.+)\s*$/i);
        if (match && match[1] && match[1].trim().length > 0) {
            return match[1].trim();
        }
    }
    return null;
}
function isAgentGeneratedPullRequest(context, pr) {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function () {
        var branchName, commits;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    branchName = (((_a = pr === null || pr === void 0 ? void 0 : pr.head) === null || _a === void 0 ? void 0 : _a.ref) || '').toLowerCase();
                    if (agentBranchPrefixes.some(function (prefix) { return branchName.startsWith(prefix); })) {
                        return [2 /*return*/, true];
                    }
                    if (!((_b = pr === null || pr === void 0 ? void 0 : pr.head) === null || _b === void 0 ? void 0 : _b.ref)) {
                        return [2 /*return*/, false];
                    }
                    return [4 /*yield*/, context.octokit.paginate(context.octokit.pulls.listCommits, context.pullRequest({ per_page: 100 }))];
                case 1:
                    commits = _c.sent();
                    return [2 /*return*/, commits.some(commitHasAgentCoAuthor)];
            }
        });
    });
}
function commitHasAgentCoAuthor(commit) {
    var _a;
    var commitMessage = (_a = commit === null || commit === void 0 ? void 0 : commit.commit) === null || _a === void 0 ? void 0 : _a.message;
    if (!commitMessage) {
        return false;
    }
    var _loop_1 = function (line) {
        var match = line.match(/^co-authored-by:\s*(.+?)\s*<[^>]+>\s*$/i);
        if (!match || !match[1]) {
            return "continue";
        }
        var coAuthorName = match[1].trim().toLowerCase();
        var hasBotSuffix = coAuthorName.includes('[bot]');
        var hasAgentIndicator = agentNameIndicators.some(function (name) { return coAuthorName.includes(name); });
        if (hasBotSuffix && hasAgentIndicator) {
            return { value: true };
        }
    };
    for (var _i = 0, _b = commitMessage.split(/\r?\n/); _i < _b.length; _i++) {
        var line = _b[_i];
        var state_1 = _loop_1(line);
        if (typeof state_1 === "object")
            return state_1.value;
    }
    return false;
}
function getLatestReviewsByUser(reviews) {
    var _a;
    var latestReviewsByUser = new Map();
    for (var _i = 0, reviews_1 = reviews; _i < reviews_1.length; _i++) {
        var review = reviews_1[_i];
        var login = (_a = review === null || review === void 0 ? void 0 : review.user) === null || _a === void 0 ? void 0 : _a.login;
        if (!login) {
            continue;
        }
        latestReviewsByUser.set(login, review);
    }
    return latestReviewsByUser;
}
function countNonBotApprovalsExcludingAutoapproval(latestReviewsByUser) {
    var count = 0;
    latestReviewsByUser.forEach(function (review, login) {
        var _a;
        if (login === autoapprovalBotLogin) {
            return;
        }
        var isBot = ((_a = review === null || review === void 0 ? void 0 : review.user) === null || _a === void 0 ? void 0 : _a.type) === 'Bot' || login.toLowerCase().endsWith('[bot]');
        if (isBot) {
            return;
        }
        if (((review === null || review === void 0 ? void 0 : review.state) || '').toUpperCase() === 'APPROVED') {
            count += 1;
        }
    });
    return count;
}
function setActionOutput(name, value) {
    var ghOutput = process.env.GITHUB_OUTPUT;
    if (!ghOutput)
        return;
    // Use multiline-safe syntax to avoid issues with special characters
    var delimiter = 'EOF_' + name;
    try {
        fs_1.default.appendFileSync(ghOutput, "".concat(name, "<<").concat(delimiter, "\n").concat(value, "\n").concat(delimiter, "\n"));
    }
    catch (e) {
        // best-effort; log and continue
        // @ts-ignore
        console.error('Failed to write action output', name, e);
    }
}
//# sourceMappingURL=index.js.map