import { useEffect, useMemo, useState } from "react";

import {
  fetchEmails,
  processEmails,
  executeTools,
  executeSingleTool,
  approveTool,
  rejectTool,
  updateToolArguments,
  overrideEmail,
  retryEmail,
  processSingleEmail,
} from "../api/emailApi";

import type { Email } from "../api/emailApi";

const EMAILS_PER_PAGE = 10;

function InboxPage() {
  const [emails, setEmails] = useState<Email[]>([]);

  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);

  const [loading, setLoading] = useState(true);

  const [processingEmails, setProcessingEmails] = useState(false);

  const [executingTools, setExecutingTools] = useState(false);

  const [executingToolId, setExecutingToolId] = useState<string | null>(null);

  const [retryingEmailId, setRetryingEmailId] = useState<string | null>(null);

  const [processingSingleEmailId, setProcessingSingleEmailId] = useState<
    string | null
  >(null);

  const [searchTerm, setSearchTerm] = useState("");

  const [selectedToolFilter, setSelectedToolFilter] = useState("ALL");

  const [selectedPriorityFilter, setSelectedPriorityFilter] = useState("ALL");

  const [approvingToolId, setApprovingToolId] = useState<string | null>(null);

  const [actionError, setActionError] = useState("");

  const [editingArgsId, setEditingArgsId] = useState<string | null>(null);

  const [argsDraft, setArgsDraft] = useState("");

  const [overrideCategory, setOverrideCategory] = useState("");

  const [overridePriority, setOverridePriority] = useState("");

  const [currentPage, setCurrentPage] = useState(1);

  async function refreshEmails() {
    const updatedEmails = await fetchEmails();

    setEmails(updatedEmails.data);

    if (selectedEmail) {
      const refreshedSelectedEmail = updatedEmails.data.find(
        (email) => email.id === selectedEmail.id,
      );

      setSelectedEmail(refreshedSelectedEmail || null);
    }
  }

  async function handleProcessEmails() {
    try {
      setProcessingEmails(true);

      await processEmails();

      await refreshEmails();
    } catch (error) {
      console.error(error);
    } finally {
      setProcessingEmails(false);
    }
  }

  async function handleExecuteTools() {
    try {
      setExecutingTools(true);

      await executeTools();

      await refreshEmails();
    } catch (error) {
      console.error(error);
    } finally {
      setExecutingTools(false);
    }
  }

  async function handleExecuteSingleTool(toolCallId: string) {
    try {
      setExecutingToolId(toolCallId);
      setActionError("");

      await executeSingleTool(toolCallId);

      await refreshEmails();
    } catch (error) {
      console.error(error);
      setActionError(
        error instanceof Error ? error.message : "Failed executing tool",
      );
    } finally {
      setExecutingToolId(null);
    }
  }

  async function handleApproveTool(toolCallId: string) {
    try {
      setApprovingToolId(toolCallId);
      setActionError("");
      await approveTool(toolCallId);
      await refreshEmails();
    } catch (error) {
      console.error(error);
      setActionError(
        error instanceof Error ? error.message : "Failed approving tool",
      );
    } finally {
      setApprovingToolId(null);
    }
  }

  async function handleRejectTool(toolCallId: string) {
    try {
      setApprovingToolId(toolCallId);
      setActionError("");
      await rejectTool(toolCallId, "Rejected from dashboard");
      await refreshEmails();
    } catch (error) {
      console.error(error);
      setActionError(
        error instanceof Error ? error.message : "Failed rejecting tool",
      );
    } finally {
      setApprovingToolId(null);
    }
  }

  async function handleSaveArguments(toolCallId: string) {
    try {
      setActionError("");
      const parsed = JSON.parse(argsDraft);
      await updateToolArguments(toolCallId, parsed);
      setEditingArgsId(null);
      await refreshEmails();
    } catch (error) {
      console.error(error);
      setActionError(
        error instanceof Error
          ? error.message
          : "Invalid JSON — arguments not saved",
      );
    }
  }

  async function handleOverrideEmail() {
    if (!selectedEmail) return;
    try {
      setActionError("");
      await overrideEmail(selectedEmail.id, {
        ...(overrideCategory ? { category: overrideCategory } : {}),
        ...(overridePriority ? { priority: overridePriority } : {}),
      });
      setOverrideCategory("");
      setOverridePriority("");
      await refreshEmails();
    } catch (error) {
      console.error(error);
      setActionError(
        error instanceof Error ? error.message : "Failed overriding triage",
      );
    }
  }

  async function handleRetryEmail(emailId: string) {
    try {
      setRetryingEmailId(emailId);

      await retryEmail(emailId);

      await refreshEmails();
    } catch (error) {
      console.error(error);
    } finally {
      setRetryingEmailId(null);
    }
  }

  async function handleProcessSingleEmail(emailId: string) {
    try {
      setProcessingSingleEmailId(emailId);

      await processSingleEmail(emailId);

      await refreshEmails();
    } catch (error) {
      console.error(error);
    } finally {
      setProcessingSingleEmailId(null);
    }
  }

  useEffect(() => {
    async function loadEmails() {
      try {
        const result = await fetchEmails();

        setEmails(result.data);
      } catch (error) {
        console.error("Failed loading emails", error);
      } finally {
        setLoading(false);
      }
    }

    loadEmails();
  }, []);

  useEffect(() => {
    if (selectedEmail) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
    }

    return () => {
      document.body.style.overflow = "auto";
    };
  }, [selectedEmail]);

  useEffect(() => {
    const hasProcessingEmails = emails.some(
      (email) =>
        email.processingStatus === "PROCESSING" ||
        email.processingStatus === "PENDING",
    );

    if (!hasProcessingEmails) return;

    const interval = setInterval(async () => {
      await refreshEmails();
    }, 3000);

    return () => clearInterval(interval);
  }, [emails]);

  const availableTools = Array.from(
    new Set(
      emails.flatMap((email) =>
        email.toolCalls.map((toolCall) => toolCall.toolName),
      ),
    ),
  );

  const filteredEmails = emails.filter((email) => {
    const matchesSearch =
      email.from.toLowerCase().includes(searchTerm.toLowerCase()) ||
      email.subject.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesTool =
      selectedToolFilter === "ALL" ||
      email.toolCalls.some(
        (toolCall) => toolCall.toolName === selectedToolFilter,
      );

    const matchesPriority =
      selectedPriorityFilter === "ALL" ||
      email.priority === selectedPriorityFilter;

    return matchesSearch && matchesTool && matchesPriority;
  });

  const totalPages = Math.ceil(filteredEmails.length / EMAILS_PER_PAGE);

  const paginatedEmails = useMemo(() => {
    const startIndex = (currentPage - 1) * EMAILS_PER_PAGE;

    return filteredEmails.slice(startIndex, startIndex + EMAILS_PER_PAGE);
  }, [filteredEmails, currentPage]);

  const totalEmails = emails.length;

  const completedCount = emails.filter(
    (email) => email.processingStatus === "COMPLETED",
  ).length;

  const failedCount = emails.filter(
    (email) => email.processingStatus === "FAILED",
  ).length;

  const processingCount = emails.filter(
    (email) => email.processingStatus === "PROCESSING",
  ).length;

  const pendingCount = emails.filter(
    (email) => email.processingStatus === "PENDING",
  ).length;

  const executedActionsCount = emails.reduce(
    (count, email) =>
      count + email.toolCalls.filter((toolCall) => toolCall.execution).length,
    0,
  );

  const executedEmailsCount = emails.filter((email) => {
    if (email.toolCalls.length === 0) return false;

    return email.toolCalls.every((toolCall) => toolCall.execution);
  }).length;

  const hasActiveProcessing = processingCount > 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-6">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />

          <p className="text-2xl font-semibold text-zinc-300">
            Loading AI Email Dashboard...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-4 md:p-10">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 mb-8">
          <h1 className="text-4xl md:text-5xl font-bold text-blue-400">
            AI Email Triage Dashboard
          </h1>

          <div className="flex flex-wrap gap-4">
            <button
              onClick={handleProcessEmails}
              disabled={
                processingEmails || executingTools || hasActiveProcessing
              }
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-900 disabled:cursor-not-allowed px-5 py-3 rounded-xl font-semibold transition"
            >
              {processingEmails ? "Processing..." : "Process Emails"}
            </button>

            <button
              onClick={handleExecuteTools}
              disabled={
                executingTools || processingEmails || hasActiveProcessing
              }
              className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-900 disabled:cursor-not-allowed px-5 py-3 rounded-xl font-semibold transition"
            >
              {executingTools ? "Executing..." : "Execute Tools"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-7 gap-4 mb-8">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <p className="text-zinc-400 text-sm mb-2">Total Emails</p>

            <p className="text-3xl font-bold text-white">{totalEmails}</p>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <p className="text-zinc-400 text-sm mb-2">Completed</p>

            <p className="text-3xl font-bold text-green-400">
              {completedCount}
            </p>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <p className="text-zinc-400 text-sm mb-2">Processing</p>

            <p className="text-3xl font-bold text-blue-400">
              {processingCount}
            </p>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <p className="text-zinc-400 text-sm mb-2">Pending</p>

            <p className="text-3xl font-bold text-yellow-400">{pendingCount}</p>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <p className="text-zinc-400 text-sm mb-2">Failed</p>

            <p className="text-3xl font-bold text-red-400">{failedCount}</p>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <p className="text-zinc-400 text-sm mb-2">Executed Actions</p>

            <p className="text-3xl font-bold text-emerald-400">
              {executedActionsCount}
            </p>
          </div>

          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <p className="text-zinc-400 text-sm mb-2">Executed Emails</p>

            <p className="text-3xl font-bold text-cyan-400">
              {executedEmailsCount}
            </p>
          </div>
        </div>

        {processingEmails && (
          <div className="mb-6 bg-blue-500/10 border border-blue-500/20 rounded-2xl p-5">
            <p className="text-blue-300 font-semibold text-lg">
              AI orchestration processing is currently running...
            </p>

            <p className="text-zinc-300 mt-2">
              Please wait while emails are being analyzed.
            </p>
          </div>
        )}

        {!processingEmails && !executingTools && completedCount > 0 && (
          <div className="mb-6 bg-green-500/10 border border-green-500/20 rounded-2xl p-5">
            <p className="text-green-300 font-semibold text-lg">
              Email orchestration completed successfully
            </p>

            <p className="text-zinc-300 mt-2">
              All orchestration metrics have been updated.
            </p>
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-4 mb-6">
          <input
            type="text"
            placeholder="Search sender or subject..."
            value={searchTerm}
            onChange={(event) => {
              setSearchTerm(event.target.value);

              setCurrentPage(1);
            }}
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white outline-none focus:border-blue-500"
          />

          <select
            value={selectedToolFilter}
            onChange={(event) => {
              setSelectedToolFilter(event.target.value);

              setCurrentPage(1);
            }}
            className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white outline-none focus:border-blue-500"
          >
            <option value="ALL">All Tools</option>

            {availableTools.map((toolName) => (
              <option key={toolName} value={toolName}>
                {toolName}
              </option>
            ))}
          </select>

          <select
            value={selectedPriorityFilter}
            onChange={(event) => {
              setSelectedPriorityFilter(event.target.value);

              setCurrentPage(1);
            }}
            className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white outline-none focus:border-blue-500"
          >
            <option value="ALL">All Priorities</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </div>

        <p className="text-zinc-500 text-sm mb-6">
          Queue is sorted critical-first (CRITICAL → HIGH → MEDIUM → LOW), then
          newest. Medium/high-risk actions require explicit approval before
          execution.
        </p>

        <div className="overflow-x-auto bg-zinc-900 rounded-2xl border border-zinc-800 shadow-2xl">
          <table className="w-full min-w-[900px]">
            <thead className="bg-zinc-800 text-zinc-300">
              <tr>
                <th className="text-left px-6 py-4">From</th>

                <th className="text-left px-6 py-4">Subject</th>

                <th className="text-left px-6 py-4">Priority</th>

                <th className="text-left px-6 py-4">Date</th>

                <th className="text-left px-6 py-4">Status</th>
              </tr>
            </thead>

            <tbody>
              {paginatedEmails.map((email) => (
                <tr
                  key={email.id}
                  onClick={() => setSelectedEmail(email)}
                  className="border-t border-zinc-800 hover:bg-zinc-800/40 transition cursor-pointer"
                >
                  <td className="px-6 py-4 text-zinc-300">{email.from}</td>

                  <td className="px-6 py-4">
                    <p>{email.subject}</p>

                    {(email.category || email.intent) && (
                      <p className="text-xs text-zinc-400 mt-1">
                        {email.category && `[${email.category}] `}
                        {email.intent || ""}
                      </p>
                    )}

                    {email.toolCalls.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {email.toolCalls.map((toolCall) => (
                          <span
                            key={toolCall.id}
                            className="bg-zinc-800 border border-zinc-700 px-2 py-1 rounded-full text-xs text-zinc-300"
                          >
                            {toolCall.toolName}
                            {toolCall.approvalStatus
                              ? ` • ${toolCall.approvalStatus}`
                              : ""}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>

                  <td className="px-6 py-4">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold
                      ${
                        email.priority === "CRITICAL"
                          ? "bg-red-500/20 text-red-400"
                          : ""
                      }
                      ${
                        email.priority === "HIGH"
                          ? "bg-orange-500/20 text-orange-400"
                          : ""
                      }
                      ${
                        email.priority === "MEDIUM"
                          ? "bg-yellow-500/20 text-yellow-400"
                          : ""
                      }
                      ${
                        email.priority === "LOW"
                          ? "bg-zinc-700/60 text-zinc-300"
                          : ""
                      }
                      ${!email.priority ? "bg-zinc-800 text-zinc-500" : ""}
                    `}
                    >
                      {email.priority || "UNTRIAGED"}
                    </span>
                  </td>

                  <td className="px-6 py-4 text-zinc-300">
                    {new Date(email.date).toLocaleDateString("en-US", {
                      timeZone: "UTC",
                    })}
                  </td>

                  <td className="px-6 py-4">
                    <span
                      className={`px-3 py-1 rounded-full text-sm font-bold
                    ${
                      email.processingStatus === "COMPLETED"
                        ? "bg-green-500/20 text-green-400"
                        : ""
                    }
                    ${
                      email.processingStatus === "FAILED"
                        ? "bg-red-500/20 text-red-400"
                        : ""
                    }
                    ${
                      email.processingStatus === "PENDING"
                        ? "bg-yellow-500/20 text-yellow-400"
                        : ""
                    }
                    ${
                      email.processingStatus === "PROCESSING"
                        ? "bg-blue-500/20 text-blue-400"
                        : ""
                    }
                  `}
                    >
                      {email.processingStatus}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-8">
            <button
              onClick={() => setCurrentPage((prev) => prev - 1)}
              disabled={currentPage === 1}
              className="bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-900 disabled:cursor-not-allowed px-5 py-2 rounded-xl font-semibold transition"
            >
              Previous
            </button>

            <p className="text-zinc-300">
              Page {currentPage} of {totalPages}
            </p>

            <button
              onClick={() => setCurrentPage((prev) => prev + 1)}
              disabled={currentPage === totalPages}
              className="bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-900 disabled:cursor-not-allowed px-5 py-2 rounded-xl font-semibold transition"
            >
              Next
            </button>
          </div>
        )}

        {selectedEmail && (
          <div
            className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 overflow-y-auto z-50"
            onClick={() => setSelectedEmail(null)}
          >
            <div
              className="bg-zinc-900 p-5 md:p-8 rounded-2xl max-w-3xl w-full border border-zinc-700 shadow-2xl max-h-[90vh] overflow-y-auto relative my-4"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                onClick={() => setSelectedEmail(null)}
                className="absolute top-4 right-4 text-zinc-400 hover:text-white text-3xl"
              >
                ×
              </button>

              <h2 className="text-2xl font-bold mb-8">Email Details</h2>

              <div className="space-y-6">
                <div>
                  <p className="text-zinc-400 mb-2">From</p>

                  <p className="font-semibold">{selectedEmail.from}</p>
                </div>

                <div>
                  <p className="text-zinc-400 mb-2">Subject</p>

                  <p className="font-semibold">{selectedEmail.subject}</p>
                </div>

                <div>
                  <p className="text-zinc-400 mb-2">Status</p>

                  <div className="flex items-center gap-4">
                    <p>{selectedEmail.processingStatus}</p>

                    <div className="flex gap-3">
                      {selectedEmail.processingStatus === "FAILED" && (
                        <button
                          onClick={() => handleRetryEmail(selectedEmail.id)}
                          disabled={retryingEmailId === selectedEmail.id}
                          className="bg-red-600 hover:bg-red-700 disabled:bg-red-900 disabled:cursor-not-allowed px-3 py-1 rounded-lg text-sm font-semibold transition"
                        >
                          {retryingEmailId === selectedEmail.id
                            ? "Retrying..."
                            : "Retry Processing"}
                        </button>
                      )}

                      {selectedEmail.processingStatus === "PENDING" && (
                        <button
                          onClick={() =>
                            handleProcessSingleEmail(selectedEmail.id)
                          }
                          disabled={
                            processingSingleEmailId === selectedEmail.id
                          }
                          className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-900 disabled:cursor-not-allowed px-3 py-1 rounded-lg text-sm font-semibold transition"
                        >
                          {processingSingleEmailId === selectedEmail.id
                            ? "Processing..."
                            : "Process Email"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <p className="text-zinc-400 mb-4">Email Body</p>

                  <div className="bg-zinc-800 p-6 rounded-2xl leading-7 text-zinc-300 whitespace-pre-wrap">
                    {selectedEmail.body}
                  </div>
                </div>

                {(selectedEmail.category ||
                  selectedEmail.priority ||
                  selectedEmail.intent) && (
                  <div className="bg-zinc-800/60 border border-zinc-700 rounded-2xl p-5">
                    <p className="text-zinc-400 mb-3 font-semibold">
                      AI Triage Insights
                    </p>
                    <div className="flex flex-wrap gap-2 mb-3 text-sm">
                      {selectedEmail.category && (
                        <span className="bg-blue-600/20 text-blue-300 px-3 py-1 rounded-full font-semibold">
                          {selectedEmail.category}
                        </span>
                      )}
                      {selectedEmail.priority && (
                        <span className="bg-yellow-500/20 text-yellow-300 px-3 py-1 rounded-full font-semibold">
                          {selectedEmail.priority}
                        </span>
                      )}
                      {typeof selectedEmail.confidence === "number" && (
                        <span className="bg-zinc-700 px-3 py-1 rounded-full text-zinc-300">
                          confidence{" "}
                          {Math.round(selectedEmail.confidence * 100)}%
                        </span>
                      )}
                    </div>
                    {selectedEmail.intent && (
                      <p className="text-zinc-200 text-sm mb-1">
                        <span className="text-zinc-400">Intent: </span>
                        {selectedEmail.intent}
                      </p>
                    )}
                    {selectedEmail.summary && (
                      <p className="text-zinc-300 text-sm">
                        <span className="text-zinc-400">Summary: </span>
                        {selectedEmail.summary}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-3 mt-4">
                      <select
                        value={overrideCategory}
                        onChange={(e) => setOverrideCategory(e.target.value)}
                        className="bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-white outline-none"
                      >
                        <option value="">Override category…</option>
                        {[
                          "MEETING",
                          "URGENT",
                          "TASK",
                          "FOLLOW_UP",
                          "INFORMATIONAL",
                          "ESCALATION",
                          "NEWSLETTER",
                          "ACTION_REQUIRED",
                          "UNCLASSIFIED",
                        ].map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      <select
                        value={overridePriority}
                        onChange={(e) => setOverridePriority(e.target.value)}
                        className="bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-white outline-none"
                      >
                        <option value="">Override priority…</option>
                        {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={handleOverrideEmail}
                        disabled={!overrideCategory && !overridePriority}
                        className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-3 py-2 rounded-xl text-sm font-semibold transition"
                      >
                        Apply Override
                      </button>
                    </div>
                  </div>
                )}

                {actionError && (
                  <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl text-red-300 text-sm">
                    {actionError}
                  </div>
                )}

                {selectedEmail.toolCalls.length > 0 && (
                  <div>
                    <p className="text-zinc-400 mb-4 font-semibold">
                      AI Suggested Actions
                    </p>

                    <div className="space-y-4">
                      {selectedEmail.toolCalls.map((toolCall) => (
                        <div
                          key={toolCall.id}
                          className="bg-zinc-800 border border-zinc-700 rounded-2xl p-5"
                        >
                          <div className="flex items-center justify-between mb-4">
                            <span className="bg-blue-600 text-white px-3 py-1 rounded-full text-sm font-semibold">
                              {toolCall.toolName}
                            </span>

                            <span className="text-xs text-zinc-400">
                              {toolCall.riskLevel
                                ? `risk ${toolCall.riskLevel}`
                                : ""}
                              {toolCall.approvalStatus
                                ? ` • ${toolCall.approvalStatus}`
                                : ""}
                            </span>
                          </div>

                          <div className="flex flex-wrap gap-2 mb-4">
                            {toolCall.execution ? (
                              <span className="text-green-400 text-sm font-semibold">
                                Executed
                              </span>
                            ) : (
                              <>
                                {toolCall.approvalStatus !== "APPROVED" && (
                                  <>
                                    <button
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleApproveTool(toolCall.id);
                                      }}
                                      disabled={
                                        approvingToolId === toolCall.id
                                      }
                                      className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-900 disabled:cursor-not-allowed px-3 py-1 rounded-lg text-sm font-semibold transition"
                                    >
                                      {approvingToolId === toolCall.id
                                        ? "Working..."
                                        : "Approve"}
                                    </button>
                                    <button
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleRejectTool(toolCall.id);
                                      }}
                                      disabled={
                                        approvingToolId === toolCall.id
                                      }
                                      className="bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 px-3 py-1 rounded-lg text-sm font-semibold transition"
                                    >
                                      Reject
                                    </button>
                                  </>
                                )}
                                <button
                                  onClick={(event) => {
                                    event.stopPropagation();

                                    handleExecuteSingleTool(toolCall.id);
                                  }}
                                  disabled={executingToolId === toolCall.id}
                                  title={
                                    toolCall.approvalStatus === "PENDING" &&
                                    toolCall.riskLevel !== "LOW"
                                      ? "Requires approval first (medium/high risk)"
                                      : "Execute tool"
                                  }
                                  className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-900 disabled:cursor-not-allowed px-3 py-1 rounded-lg text-sm font-semibold transition"
                                >
                                  {executingToolId === toolCall.id
                                    ? "Executing..."
                                    : "Execute Tool"}
                                </button>
                              </>
                            )}
                          </div>

                          <div className="mb-5">
                            <p className="text-zinc-400 mb-2">Rationale</p>

                            <p className="text-zinc-200 leading-7">
                              {toolCall.rationale}
                            </p>
                          </div>

                          <div className="mb-5">
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-zinc-400">Arguments</p>
                              {!toolCall.execution &&
                                editingArgsId !== toolCall.id && (
                                  <button
                                    onClick={() => {
                                      setEditingArgsId(toolCall.id);
                                      setArgsDraft(
                                        JSON.stringify(
                                          toolCall.argumentsJson,
                                          null,
                                          2,
                                        ),
                                      );
                                    }}
                                    className="text-xs text-blue-400 hover:text-blue-300 font-semibold"
                                  >
                                    Edit draft
                                  </button>
                                )}
                            </div>

                            {editingArgsId === toolCall.id ? (
                              <div>
                                <textarea
                                  value={argsDraft}
                                  onChange={(e) =>
                                    setArgsDraft(e.target.value)
                                  }
                                  rows={6}
                                  className="w-full bg-zinc-950 p-4 rounded-xl text-sm text-zinc-200 border border-zinc-700 outline-none focus:border-blue-500 font-mono"
                                />
                                <div className="flex gap-2 mt-2">
                                  <button
                                    onClick={() =>
                                      handleSaveArguments(toolCall.id)
                                    }
                                    className="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded-lg text-sm font-semibold transition"
                                  >
                                    Save
                                  </button>
                                  <button
                                    onClick={() => setEditingArgsId(null)}
                                    className="bg-zinc-700 hover:bg-zinc-600 px-3 py-1 rounded-lg text-sm font-semibold transition"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <pre className="bg-zinc-950 p-4 rounded-xl text-sm overflow-x-auto text-zinc-300">
                                {JSON.stringify(toolCall.argumentsJson, null, 2)}
                              </pre>
                            )}
                          </div>

                          {toolCall.execution && (
                            <div>
                              <p className="text-zinc-400 mb-2">
                                Execution Result
                              </p>

                              <pre className="bg-zinc-950 p-4 rounded-xl text-sm overflow-x-auto text-zinc-300">
                                {JSON.stringify(
                                  toolCall.execution.executionResultJson,
                                  null,
                                  2,
                                )}
                              </pre>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedEmail.processingError && (
                  <div>
                    <p className="text-red-400 mb-3">Processing Error</p>

                    <div className="bg-red-500/10 border border-red-500/20 p-5 rounded-2xl text-red-300 overflow-x-auto">
                      {selectedEmail.processingError}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default InboxPage;
