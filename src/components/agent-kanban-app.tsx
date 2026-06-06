"use client"

import * as React from "react"
import {
  ArrowClockwiseIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CircleDashedIcon,
  CircleNotchIcon,
  CirclesFourIcon,
  ClockIcon,
  FileIcon,
  GitBranchIcon,
  HourglassIcon,
  ImageSquareIcon,
  KanbanIcon,
  LinkIcon,
  MagnifyingGlassIcon,
  PlayIcon,
  PlusIcon,
  RocketLaunchIcon,
  SignOutIcon,
  WarningCircleIcon,
  XCircleIcon,
  XIcon,
} from "@phosphor-icons/react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import type {
  AgentCard,
  AgentListResponse,
  CreateAgentResponse,
  ModelOption,
  PublicSession,
  RepositoryOption,
} from "@/lib/agents/types"
import { cn } from "@/lib/utils"

type GroupBy = "status" | "repository" | "branch" | "createdAt"
type IconComponent = React.ElementType

type GroupOption = {
  id: GroupBy
  label: string
  icon: IconComponent
  requiresData?: keyof AgentCard
}

type SelectableGroupOption = GroupOption & {
  selectable: boolean
}

type SidebarFilter = "all" | "withArtifacts" | "prAgents" | "recentlyActive"

type AppStatus = "checking" | "onboarding" | "ready"

type ApiError = {
  code?: string
  error?: string
}

const sessionStorageKey = "agent-kanban-session-id"
const preferencesStorageKey = "agent-kanban-preferences"
const defaultGroupBy: GroupBy = "status"
const autoRefreshIntervalMs = 20_000

type StoredPreferences = {
  groupBy?: GroupBy
  sidebarFilter?: SidebarFilter
  isSidebarCollapsed?: boolean
  includeArchived?: boolean
}

const groupByValues: ReadonlySet<string> = new Set<GroupBy>([
  "status",
  "repository",
  "branch",
  "createdAt",
])
const sidebarFilterValues: ReadonlySet<string> = new Set<SidebarFilter>([
  "all",
  "withArtifacts",
  "prAgents",
  "recentlyActive",
])

function readStoredPreferences(): StoredPreferences {
  if (typeof window === "undefined") {
    return {}
  }

  try {
    const raw = window.localStorage.getItem(preferencesStorageKey)
    if (!raw) {
      return {}
    }

    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") {
      return {}
    }

    const candidate = parsed as Record<string, unknown>
    const next: StoredPreferences = {}

    if (typeof candidate.groupBy === "string" && groupByValues.has(candidate.groupBy)) {
      next.groupBy = candidate.groupBy as GroupBy
    }
    if (
      typeof candidate.sidebarFilter === "string" &&
      sidebarFilterValues.has(candidate.sidebarFilter)
    ) {
      next.sidebarFilter = candidate.sidebarFilter as SidebarFilter
    }
    if (typeof candidate.isSidebarCollapsed === "boolean") {
      next.isSidebarCollapsed = candidate.isSidebarCollapsed
    }
    if (typeof candidate.includeArchived === "boolean") {
      next.includeArchived = candidate.includeArchived
    }

    return next
  } catch {
    return {}
  }
}

function writeStoredPreferences(prefs: StoredPreferences) {
  if (typeof window === "undefined") {
    return
  }

  try {
    window.localStorage.setItem(preferencesStorageKey, JSON.stringify(prefs))
  } catch {
    // Storage may be unavailable (private mode, quota); ignore.
  }
}

const groupOptions: GroupOption[] = [
  { id: "status", label: "Status", icon: CirclesFourIcon },
  { id: "repository", label: "Repository", icon: KanbanIcon },
  { id: "branch", label: "Branch", icon: GitBranchIcon, requiresData: "branch" },
  { id: "createdAt", label: "Created date", icon: ClockIcon },
]

const dateBucketOrder = new Map([
  ["Today", 0],
  ["Yesterday", 1],
  ["This week", 2],
  ["This month", 3],
  ["Older", 4],
  ["No date", 5],
])

const sidebarFilters: {
  id: SidebarFilter
  label: string
  icon: IconComponent
}[] = [
  { id: "all", label: "All agents", icon: CirclesFourIcon },
  { id: "withArtifacts", label: "With artifacts", icon: ImageSquareIcon },
  { id: "prAgents", label: "PR agents", icon: GitBranchIcon },
  { id: "recentlyActive", label: "Recently active", icon: ClockIcon },
]

const boardLoadingColumns: {
  id: string
  title: string
  icon: IconComponent
  cards: number
}[] = [
  { id: "queued", title: "Queued", icon: CirclesFourIcon, cards: 3 },
  { id: "running", title: "Running", icon: ClockIcon, cards: 2 },
  { id: "review", title: "Review", icon: KanbanIcon, cards: 3 },
]

const loadingCardLineWidths = [
  ["w-11/12", "w-2/3"],
  ["w-4/5", "w-1/2"],
  ["w-3/4", "w-5/6"],
] as const

export function AgentKanbanApp() {
  const [status, setStatus] = React.useState<AppStatus>("checking")
  const [session, setSession] = React.useState<PublicSession | null>(null)
  const [agents, setAgents] = React.useState<AgentCard[]>([])
  const [repositories, setRepositories] = React.useState<RepositoryOption[]>([])
  const [models, setModels] = React.useState<ModelOption[]>([])
  const [groupBy, setGroupBy] = React.useState<GroupBy>(
    () => readStoredPreferences().groupBy ?? defaultGroupBy
  )
  const [sidebarFilter, setSidebarFilter] = React.useState<SidebarFilter>(
    () => readStoredPreferences().sidebarFilter ?? "all"
  )
  const [includeArchived, setIncludeArchived] = React.useState(
    () => readStoredPreferences().includeArchived ?? false
  )
  const [query, setQuery] = React.useState("")
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [isCreateOpen, setIsCreateOpen] = React.useState(false)
  const [isShortcutsOpen, setIsShortcutsOpen] = React.useState(false)
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = React.useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = React.useState(
    () => readStoredPreferences().isSidebarCollapsed ?? false
  )
  const [lastSyncedAt, setLastSyncedAt] = React.useState<number | null>(null)
  const [nextCursor, setNextCursor] = React.useState<string | null>(null)
  const [isLoadingMore, setIsLoadingMore] = React.useState(false)
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  const loadBoard = React.useCallback(
    async (
      sessionId: string,
      options: { includeArchived?: boolean } = {}
    ) => {
      setIsLoading(true)
      setError(null)
      try {
        const agentsPath = options.includeArchived
          ? "/api/agents?includeArchived=true"
          : "/api/agents"
        const [agentResult, repositoryResult, modelResult] = await Promise.all([
          apiFetch<AgentListResponse>(agentsPath, sessionId),
          apiFetch<{ repositories: RepositoryOption[] }>(
            "/api/repositories",
            sessionId
          ),
          apiFetch<{ models: ModelOption[] }>("/api/models", sessionId),
        ])
        setAgents(agentResult.agents)
        setNextCursor(agentResult.nextCursor ?? null)
        setRepositories(repositoryResult.repositories)
        setModels(modelResult.models)
        setLastSyncedAt(Date.now())
      } catch (loadError) {
        setError(errorMessage(loadError, "Failed to load cloud agents."))
      } finally {
        setIsLoading(false)
      }
    },
    []
  )

  // Silent background refresh used by polling and visibility changes.
  // Doesn't toggle isLoading or surface errors so the user can keep working
  // with whatever data is already on the board.
  const refreshAgentsQuietly = React.useCallback(
    async (
      sessionId: string,
      options: { includeArchived?: boolean } = {}
    ) => {
      try {
        const agentsPath = options.includeArchived
          ? "/api/agents?includeArchived=true"
          : "/api/agents"
        const result = await apiFetch<AgentListResponse>(agentsPath, sessionId)
        setAgents(result.agents)
        setNextCursor(result.nextCursor ?? null)
        setLastSyncedAt(Date.now())
      } catch {
        // Intentionally swallowed; manual refresh will surface errors loudly.
      }
    },
    []
  )

  React.useEffect(() => {
    let cancelled = false

    async function restore() {
      const existingSessionId = window.localStorage.getItem(sessionStorageKey)
      try {
        const restored = await fetchJson<PublicSession>("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: existingSessionId }),
        })
        if (cancelled) {
          return
        }
        window.localStorage.setItem(sessionStorageKey, restored.id)
        setSession(restored)
        setStatus("ready")
        await loadBoard(restored.id, {
          includeArchived: readStoredPreferences().includeArchived ?? false,
        })
      } catch {
        if (!cancelled) {
          window.localStorage.removeItem(sessionStorageKey)
          setStatus("onboarding")
        }
      }
    }

    restore()
    return () => {
      cancelled = true
    }
  }, [loadBoard])

  React.useEffect(() => {
    if (status !== "ready" || !session) {
      return
    }

    const sessionId = session.id

    function isTabVisible() {
      return (
        typeof document === "undefined" ||
        document.visibilityState === "visible"
      )
    }

    function tick() {
      if (!isTabVisible()) {
        return
      }
      void refreshAgentsQuietly(sessionId, { includeArchived })
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        tick()
      }
    }

    const intervalId = window.setInterval(tick, autoRefreshIntervalMs)
    document.addEventListener("visibilitychange", handleVisibilityChange)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [status, session, refreshAgentsQuietly, includeArchived])

  async function handleSessionCreated(nextSession: PublicSession) {
    window.localStorage.setItem(sessionStorageKey, nextSession.id)
    setSession(nextSession)
    setStatus("ready")
    await loadBoard(nextSession.id, { includeArchived })
  }

  const handleRefresh = React.useCallback(async () => {
    if (!session) {
      return
    }
    await loadBoard(session.id, { includeArchived })
  }, [session, loadBoard, includeArchived])

  const handleLoadMore = React.useCallback(async () => {
    if (!session || !nextCursor) {
      return
    }

    setIsLoadingMore(true)
    setError(null)
    try {
      const params = new URLSearchParams({ cursor: nextCursor })
      if (includeArchived) {
        params.set("includeArchived", "true")
      }
      const result = await apiFetch<AgentListResponse>(
        `/api/agents?${params.toString()}`,
        session.id
      )
      setAgents((current) => mergeAgentLists(current, result.agents))
      setNextCursor(result.nextCursor ?? null)
      setLastSyncedAt(Date.now())
    } catch (loadError) {
      setError(errorMessage(loadError, "Failed to load more cloud agents."))
    } finally {
      setIsLoadingMore(false)
    }
  }, [session, nextCursor, includeArchived])

  async function handleForgetKey() {
    window.localStorage.removeItem(sessionStorageKey)
    window.localStorage.removeItem(preferencesStorageKey)
    await fetch("/api/session", { method: "DELETE" })
    setSession(null)
    setAgents([])
    setRepositories([])
    setModels([])
    setLastSyncedAt(null)
    setNextCursor(null)
    setStatus("onboarding")
  }

  async function handleAgentCreated(agent: AgentCard) {
    setAgents((current) => [agent, ...current])
    if (session) {
      await loadBoard(session.id, { includeArchived })
    }
  }

  React.useEffect(() => {
    if (status !== "ready") {
      return
    }

    writeStoredPreferences({
      groupBy,
      sidebarFilter,
      isSidebarCollapsed,
      includeArchived,
    })
  }, [status, groupBy, sidebarFilter, isSidebarCollapsed, includeArchived])

  React.useEffect(() => {
    if (status !== "ready") {
      return
    }

    function isEditableTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) {
        return false
      }
      const tagName = target.tagName
      if (
        tagName === "INPUT" ||
        tagName === "TEXTAREA" ||
        tagName === "SELECT"
      ) {
        return true
      }
      return target.isContentEditable
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) {
        return
      }

      if (event.key === "Escape") {
        if (isCreateOpen) {
          setIsCreateOpen(false)
          event.preventDefault()
          return
        }
        if (isShortcutsOpen) {
          setIsShortcutsOpen(false)
          event.preventDefault()
          return
        }
        if (isMobileFiltersOpen) {
          setIsMobileFiltersOpen(false)
          event.preventDefault()
          return
        }
        if (
          document.activeElement === searchInputRef.current &&
          query.length > 0
        ) {
          setQuery("")
          event.preventDefault()
          return
        }
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur()
        }
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }
      if (isEditableTarget(event.target)) {
        return
      }
      if (isCreateOpen) {
        return
      }

      switch (event.key) {
        case "/":
          event.preventDefault()
          searchInputRef.current?.focus()
          searchInputRef.current?.select()
          break
        case "n":
        case "N":
          event.preventDefault()
          setIsCreateOpen(true)
          break
        case "r":
        case "R":
          event.preventDefault()
          void handleRefresh()
          break
        case "c":
        case "C":
          event.preventDefault()
          setIsSidebarCollapsed((value) => !value)
          break
        case "?":
          event.preventDefault()
          setIsShortcutsOpen((value) => !value)
          break
        default:
          break
      }
    }

    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [
    status,
    isCreateOpen,
    isShortcutsOpen,
    isMobileFiltersOpen,
    query,
    handleRefresh,
  ])

  const selectableGroupOptions = React.useMemo(
    () => getSelectableGroupOptions(agents),
    [agents]
  )
  const selectedGroupBy = isSelectableGroupBy(groupBy, selectableGroupOptions)
    ? groupBy
    : defaultGroupBy

  if (status === "checking") {
    return <LoadingScreen />
  }

  if (status === "onboarding" || !session) {
    return <OnboardingScreen onSessionCreated={handleSessionCreated} />
  }

  const searchedAgents = searchAgents(agents, query)
  const visibleAgents = filterAgentsBySidebar(searchedAgents, sidebarFilter)
  const showBoardLoading = isLoading && agents.length === 0 && visibleAgents.length === 0
  const sidebarItems = sidebarFilters.map((item) => ({
    ...item,
    count: filterAgentsBySidebar(searchedAgents, item.id).length,
  }))
  const selectedGroupOption = groupOptions.find((option) => option.id === selectedGroupBy)
  const SelectedGroupIcon = selectedGroupOption?.icon
  const groups = groupAgents(visibleAgents, selectedGroupBy)
  const activeFilterLabel = sidebarFilters.find((item) => item.id === sidebarFilter)?.label
  const hasActiveFilters = Boolean(query.trim()) || sidebarFilter !== "all"
  const boardStats = getBoardStats(agents, visibleAgents)
  const signedInName = session.user?.name ?? "Cursor user"
  const signedInLabel = session.user?.email
    ? `${signedInName} (${session.user.email})`
    : signedInName
  const signedInInitial = signedInName.trim().charAt(0).toUpperCase() || "C"

  return (
    <div className="relative isolate flex h-screen min-h-0 overflow-hidden bg-background text-foreground">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_80%_60%_at_55%_-20%,oklch(0.68_0.18_264_/_0.18),transparent_65%),linear-gradient(180deg,transparent,oklch(0_0_0_/_0.03))]"
      />
      <aside
        className={cn(
          "hidden shrink-0 border-r bg-sidebar/85 shadow-xl shadow-black/5 backdrop-blur-xl transition-[width] duration-200 dark:shadow-black/20 lg:flex lg:flex-col",
          isSidebarCollapsed ? "w-16" : "w-64"
        )}
      >
        <div
          className={cn(
            "flex h-14 items-center px-3",
            isSidebarCollapsed ? "justify-center" : "gap-2"
          )}
        >
          {isSidebarCollapsed ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setIsSidebarCollapsed(false)}
              aria-label="Expand sidebar"
              title="Expand sidebar"
            >
              <CaretRightIcon />
            </Button>
          ) : (
            <>
              <div className="flex size-8 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/75 text-primary-foreground shadow-sm shadow-primary/40 ring-1 ring-primary-foreground/15">
                <KanbanIcon aria-hidden="true" className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold tracking-tight">Agent Kanban</div>
                <div className="truncate text-xs text-muted-foreground">
                  Cursor Cloud Agents
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setIsSidebarCollapsed(true)}
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
              >
                <CaretLeftIcon />
              </Button>
            </>
          )}
        </div>
        <Separator />
        <nav
          className={cn(
            "flex flex-1 flex-col gap-1.5 text-sm",
            isSidebarCollapsed ? "items-center p-2" : "p-3"
          )}
          aria-label="Agent filters"
        >
          {sidebarItems.map((item) => (
            <SidebarItem
              key={item.id}
              active={sidebarFilter === item.id}
              collapsed={isSidebarCollapsed}
              count={item.count}
              icon={item.icon}
              label={item.label}
              onSelect={() => setSidebarFilter(item.id)}
            />
          ))}
        </nav>
        <Separator />
        {isSidebarCollapsed ? (
          <div className="flex flex-col items-center gap-2 p-2">
            <div
              className="flex size-9 items-center justify-center rounded-lg border bg-background/60 text-sm font-medium"
              aria-label={`Signed in as ${signedInLabel}`}
              title={`Signed in as ${signedInLabel}`}
            >
              {signedInInitial}
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={handleForgetKey}
              aria-label="Forget API key"
              title="Forget API key"
            >
              <SignOutIcon />
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 p-3">
            <div className="rounded-xl border bg-background/70 p-3 shadow-sm">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary ring-1 ring-primary/20">
                  {signedInInitial}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-muted-foreground">Signed in</div>
                  <div className="truncate text-sm font-medium">{signedInName}</div>
                </div>
              </div>
              {session.user?.email ? (
                <div className="mt-2 truncate rounded-md bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
                  {session.user.email}
                </div>
              ) : null}
            </div>
            <Button variant="ghost" size="sm" onClick={handleForgetKey}>
              Forget API key
            </Button>
          </div>
        )}
      </aside>

      <main
        id="main-content"
        tabIndex={-1}
        className="relative flex min-w-0 flex-1 flex-col outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset"
      >
        <header className="flex h-16 shrink-0 items-center gap-3 border-b bg-background/75 px-4 shadow-sm shadow-black/5 backdrop-blur-xl">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => setIsMobileFiltersOpen(true)}
            aria-label="Open filters"
            className="shrink-0 lg:hidden"
          >
            <CirclesFourIcon aria-hidden="true" />
          </Button>
          <div className="relative flex min-w-48 flex-1 items-center">
            <MagnifyingGlassIcon
              aria-hidden="true"
              className="pointer-events-none absolute left-3 size-4 text-muted-foreground"
            />
            <Input
              ref={searchInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search agents and repos..."
              aria-label="Search agents and repositories"
              className="h-9 rounded-xl border-border/60 bg-card/70 pl-9 pr-10 shadow-inner shadow-black/5 transition focus-visible:bg-card"
            />
            {query ? (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  setQuery("")
                  searchInputRef.current?.focus()
                }}
                aria-label="Clear search"
                className="absolute right-1 size-7"
              >
                <XIcon aria-hidden="true" className="size-3.5" />
              </Button>
            ) : (
              <Kbd
                className="pointer-events-none absolute right-2 hidden md:inline-flex"
                aria-hidden="true"
              >
                /
              </Kbd>
            )}
          </div>

          <Select
            items={selectableGroupOptions.map((option) => ({
              label: groupOptionLabel(option),
              value: option.id,
            }))}
            value={selectedGroupBy}
            onValueChange={(value) => {
              if (isSelectableGroupBy(value, selectableGroupOptions)) {
                setGroupBy(value)
              } else {
                setGroupBy(defaultGroupBy)
              }
            }}
          >
            <SelectTrigger aria-label="Group agents" size="sm" className="bg-card/70 shadow-sm">
              {SelectedGroupIcon ? (
                <SelectedGroupIcon
                  aria-hidden="true"
                  className="text-muted-foreground"
                />
              ) : null}
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectGroup>
                {selectableGroupOptions.map((option) => (
                  <SelectItem
                    key={option.id}
                    value={option.id}
                    disabled={!option.selectable}
                  >
                    <GroupOptionContent option={option} />
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          <CheckboxPill
            checked={includeArchived}
            label="Archived"
            className="hidden md:flex"
            onChange={(checked) => {
              setIncludeArchived(checked)
              if (session) {
                void loadBoard(session.id, { includeArchived: checked })
              }
            }}
          />

          <div className="hidden shrink-0 items-center gap-2 text-xs text-muted-foreground xl:flex">
            {hasActiveFilters ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setQuery("")
                  setSidebarFilter("all")
                }}
                className="h-6 px-2 text-xs"
              >
                Reset filters
              </Button>
            ) : null}
            <HeaderMetric label="Visible" value={visibleAgents.length} />
            <HeaderMetric label="Active" value={boardStats.activeCount} />
            <HeaderMetric label="Artifacts" value={boardStats.artifactCount} />
            <HeaderMetric label="PRs" value={boardStats.prCount} />
            {isLoading ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                <CircleNotchIcon aria-hidden="true" className="size-3 animate-spin" />
                Syncing
              </span>
            ) : (
              <Badge
                variant="outline"
                title={
                  lastSyncedAt
                    ? `Last synced ${formatAbsoluteTime(lastSyncedAt)} · auto-refresh every ${
                        autoRefreshIntervalMs / 1000
                      }s`
                    : `Auto-refresh every ${autoRefreshIntervalMs / 1000}s`
                }
              >
                Live
              </Badge>
            )}
          </div>
          <div className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex xl:hidden">
            {isLoading ? (
              <>
                <CircleNotchIcon aria-hidden="true" className="size-4 animate-spin text-primary" />
                Syncing
              </>
            ) : lastSyncedAt ? (
              <>Synced {formatRelativeTimestamp(lastSyncedAt)}</>
            ) : (
              "Live"
            )}
          </div>

          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isLoading} className="bg-card/70 shadow-sm">
            <ArrowClockwiseIcon data-icon="inline-start" className={isLoading ? "animate-spin" : ""} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button size="sm" onClick={() => setIsCreateOpen(true)} className="shadow-sm shadow-primary/20">
            <PlusIcon data-icon="inline-start" />
            <span className="hidden sm:inline">New agent</span>
            <span className="sm:hidden">New</span>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setIsShortcutsOpen(true)}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            className="hidden md:inline-flex"
          >
            <Kbd aria-hidden="true">?</Kbd>
          </Button>
        </header>

        {error ? (
          <div className="flex items-center gap-2 border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            <WarningCircleIcon aria-hidden="true" className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <section className="flex min-h-0 flex-1 flex-col bg-[linear-gradient(180deg,oklch(1_0_0_/_0.04),transparent_35%)]">
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex min-h-full gap-4 p-4 lg:p-5">
              {groups.length > 0 ? (
                <>
                  {groups.map((group) => (
                    <BoardColumn
                      key={group.id}
                      title={group.title}
                      icon={selectedGroupOption?.icon ?? CirclesFourIcon}
                      agents={group.agents}
                    />
                  ))}
                  {nextCursor ? (
                    <LoadMoreColumn
                      isLoading={isLoadingMore}
                      onLoadMore={handleLoadMore}
                    />
                  ) : null}
                </>
              ) : showBoardLoading ? (
                <BoardLoadingSkeleton />
              ) : agents.length > 0 ? (
                <FilteredEmptyBoard
                  query={query}
                  filterLabel={sidebarFilter !== "all" ? activeFilterLabel : undefined}
                  onClear={() => {
                    setQuery("")
                    setSidebarFilter("all")
                    searchInputRef.current?.focus()
                  }}
                />
              ) : (
                <EmptyBoard onCreate={() => setIsCreateOpen(true)} />
              )}
            </div>
          </ScrollArea>
        </section>
      </main>

      {isCreateOpen ? (
        <CreateAgentDialog
          sessionId={session.id}
          models={models}
          repositories={repositories}
          onClose={() => setIsCreateOpen(false)}
          onCreated={handleAgentCreated}
        />
      ) : null}

      {isShortcutsOpen ? (
        <ShortcutsDialog onClose={() => setIsShortcutsOpen(false)} />
      ) : null}

      {isMobileFiltersOpen ? (
        <MobileFiltersDialog
          items={sidebarItems}
          activeFilter={sidebarFilter}
          onClose={() => setIsMobileFiltersOpen(false)}
          onSelect={(nextFilter) => {
            setSidebarFilter(nextFilter)
            setIsMobileFiltersOpen(false)
          }}
        />
      ) : null}
    </div>
  )
}

function Kbd({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-border/60 bg-muted/60 px-1.5 font-mono text-[0.65rem] font-medium text-muted-foreground leading-none",
        className
      )}
      {...props}
    >
      {children}
    </kbd>
  )
}

function HeaderMetric({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-card/70 px-2.5 py-1 shadow-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </span>
  )
}

function CheckboxPill({
  checked,
  className,
  label,
  onChange,
}: {
  checked: boolean
  className?: string
  label: string
  onChange: (checked: boolean) => void
}) {
  return (
    <label
      className={cn(
        "shrink-0 cursor-pointer items-center gap-2 rounded-full border border-border/60 bg-card/70 px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-sm transition hover:text-foreground",
        checked && "border-primary/30 bg-primary/10 text-primary",
        className
      )}
    >
      <input
        type="checkbox"
        className="size-3.5 accent-primary"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  )
}

const shortcutItems: { keys: string[]; description: string }[] = [
  { keys: ["/"], description: "Focus search" },
  { keys: ["n"], description: "New agent" },
  { keys: ["r"], description: "Refresh board" },
  { keys: ["c"], description: "Toggle sidebar" },
  { keys: ["?"], description: "Show this list" },
  { keys: ["Esc"], description: "Close dialog or clear search" },
]

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-40 flex animate-in fade-in-0 items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <Card
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="w-full max-w-sm animate-in zoom-in-95 slide-in-from-bottom-2 border-border/70 bg-card/95 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <CardHeader className="border-b">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle id="shortcuts-title">Keyboard shortcuts</CardTitle>
              <CardDescription>
                Move around the board without leaving the keyboard.
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="Close"
            >
              <XIcon />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2 text-sm">
            {shortcutItems.map((item) => (
              <li
                key={item.description}
                className="flex items-center justify-between gap-3"
              >
                <span className="text-muted-foreground">{item.description}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {item.keys.map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

function MobileFiltersDialog({
  items,
  activeFilter,
  onSelect,
  onClose,
}: {
  items: Array<{
    id: SidebarFilter
    label: string
    icon: IconComponent
    count: number
  }>
  activeFilter: SidebarFilter
  onSelect: (filter: SidebarFilter) => void
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex animate-in fade-in-0 items-end bg-background/80 p-4 backdrop-blur-sm sm:items-center sm:justify-center"
      onClick={onClose}
    >
      <Card
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-filters-title"
        className="w-full max-w-sm animate-in zoom-in-95 slide-in-from-bottom-4 rounded-2xl border-border/70 bg-card/95 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <CardHeader className="border-b">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle id="mobile-filters-title">Filters</CardTitle>
              <CardDescription>Choose which agents are visible.</CardDescription>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="Close filters"
            >
              <XIcon />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <nav className="flex flex-col gap-1" aria-label="Mobile agent filters">
            {items.map((item) => (
              <SidebarItem
                key={item.id}
                active={activeFilter === item.id}
                count={item.count}
                icon={item.icon}
                label={item.label}
                onSelect={() => onSelect(item.id)}
              />
            ))}
          </nav>
        </CardContent>
      </Card>
    </div>
  )
}

function LoadingScreen() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,oklch(0.68_0.18_264_/_0.18),transparent),linear-gradient(180deg,transparent,oklch(0_0_0_/_0.03))]"
      />
      <div className="relative flex w-full max-w-sm flex-col items-center gap-5 rounded-3xl border border-border/60 bg-card/75 p-8 text-center shadow-2xl shadow-black/10 backdrop-blur-xl">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/75 shadow-lg shadow-primary/30 ring-1 ring-primary-foreground/15">
          <KanbanIcon aria-hidden="true" className="size-7 text-primary-foreground" />
        </div>
        <div>
          <div className="flex items-center justify-center gap-2 text-sm font-medium text-foreground">
            <CircleNotchIcon aria-hidden="true" className="size-4 animate-spin text-primary" />
            Loading Agent Kanban
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Checking for a saved API key…</p>
        </div>
        <div className="flex w-full flex-col gap-2" aria-hidden="true">
          <div className="h-2.5 w-full animate-pulse rounded-full bg-muted" />
          <div className="h-2.5 w-8/12 animate-pulse rounded-full bg-muted/70" />
        </div>
      </div>
    </div>
  )
}

function OnboardingScreen({
  onSessionCreated,
}: {
  onSessionCreated: (session: PublicSession) => Promise<void>
}) {
  const [apiKey, setApiKey] = React.useState("")
  const [rememberKey, setRememberKey] = React.useState(true)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedApiKey = apiKey.trim()
    if (!trimmedApiKey.startsWith("crsr_")) {
      setError("Cursor API keys start with crsr_. Please check the key and try again.")
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      const session = await fetchJson<PublicSession>("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: trimmedApiKey, remember: rememberKey }),
      })
      await onSessionCreated(session)
    } catch (submitError) {
      setError(errorMessage(submitError, "Unable to validate the API key."))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,oklch(0.68_0.18_264_/_0.2),transparent),linear-gradient(180deg,transparent,oklch(0_0_0_/_0.04))]"
      />
      <div className="relative grid w-full max-w-5xl gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-3xl bg-gradient-to-br from-primary to-primary/75 shadow-lg shadow-primary/30 ring-1 ring-primary-foreground/15">
            <KanbanIcon aria-hidden="true" className="size-7 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Agent Kanban</h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
            A kanban board for your Cursor Cloud Agents
          </p>
          <OnboardingHighlights />
        </div>
        <Card className="border border-border/60 bg-card/90 shadow-2xl shadow-black/10 backdrop-blur-xl">
          <CardHeader className="gap-1 pb-2">
            <CardTitle className="text-base">Connect your Cursor account</CardTitle>
            <CardDescription>
              Enter your API key to load cloud agents.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                API key
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="crsr_..."
                  autoComplete="off"
                  aria-invalid={Boolean(error)}
                  className="font-mono"
                />
              </label>
              <label className="flex items-start gap-2 rounded-xl border border-border/50 bg-muted/30 p-3 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-primary"
                  checked={rememberKey}
                  onChange={(event) => setRememberKey(event.target.checked)}
                />
                <span>
                  Remember this key on this machine at{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">~/.agent-kanban</code>.
                </span>
              </label>
              {error ? (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <WarningCircleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                  {error}
                </div>
              ) : null}
              <Button type="submit" disabled={!apiKey.trim() || isSubmitting} className="mt-1">
                {isSubmitting ? (
                  <>
                    <CircleNotchIcon data-icon="inline-start" className="animate-spin" />
                    Validating…
                  </>
                ) : (
                  "Continue"
                )}
              </Button>
            </form>
          </CardContent>
          <CardFooter className="justify-between gap-2 border-t border-border/40 text-xs text-muted-foreground">
            <span>Need an API key?</span>
            <a
              className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
              href="https://cursor.com/dashboard/integrations"
              target="_blank"
              rel="noreferrer"
            >
              Get one at cursor.com
              <LinkIcon aria-hidden="true" className="size-3" />
            </a>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}

function OnboardingHighlights() {
  const highlights = [
    "Track agent status",
    "Preview artifacts",
    "Open pull requests",
  ]

  return (
    <div className="mt-5 flex flex-wrap justify-center gap-2">
      {highlights.map((highlight) => (
        <Badge key={highlight} variant="outline" className="bg-background/60">
          {highlight}
        </Badge>
      ))}
    </div>
  )
}

function BoardColumn({
  title,
  icon: Icon,
  agents,
}: {
  title: string
  icon: IconComponent
  agents: AgentCard[]
}) {
  return (
    <section className="flex w-[21rem] shrink-0 flex-col overflow-hidden rounded-2xl border border-border/50 bg-card/45 shadow-sm backdrop-blur-sm">
      <header className="flex items-center justify-between border-b border-border/40 bg-muted/30 px-3 py-3">
        <div className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-lg bg-background/70 shadow-sm ring-1 ring-border/50">
            <Icon aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
          </span>
          <h2 className="truncate text-sm font-semibold tracking-tight">{title}</h2>
        </div>
        <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-background/70 px-2 text-xs font-semibold text-muted-foreground shadow-sm ring-1 ring-border/60">
          {agents.length}
        </span>
      </header>
      <div className="flex flex-col gap-2.5 p-2.5">
        {agents.map((agent) => (
          <AgentCardPreview key={agent.id} agent={agent} />
        ))}
      </div>
    </section>
  )
}

function LoadMoreColumn({
  isLoading,
  onLoadMore,
}: {
  isLoading: boolean
  onLoadMore: () => void
}) {
  return (
    <section className="flex w-72 shrink-0 flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-card/35 p-5 text-center shadow-sm backdrop-blur-sm transition hover:bg-card/50">
      <div className="mb-3 flex size-11 items-center justify-center rounded-2xl bg-background/75 text-muted-foreground shadow-sm ring-1 ring-border/60">
        <ArrowClockwiseIcon
          aria-hidden="true"
          className={cn("size-5", isLoading && "animate-spin text-primary")}
        />
      </div>
      <h2 className="text-sm font-semibold">More agents available</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Load the next page without losing your current search or grouping.
      </p>
      <Button
        className="mt-4"
        size="sm"
        variant="outline"
        onClick={onLoadMore}
        disabled={isLoading}
      >
        {isLoading ? "Loading..." : "Load more agents"}
      </Button>
    </section>
  )
}

function BoardLoadingSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading cloud agents"
      className="flex min-h-[60vh] flex-1 gap-4"
    >
      <span className="sr-only">Loading cloud agents</span>
      {boardLoadingColumns.map((column) => {
        const Icon = column.icon

        return (
          <section
            key={column.id}
            className="flex w-[21rem] shrink-0 flex-col overflow-hidden rounded-2xl border border-border/50 bg-card/45 shadow-sm backdrop-blur-sm"
          >
            <header className="flex items-center justify-between border-b border-border/40 bg-muted/30 px-3 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-lg bg-background/70 text-muted-foreground shadow-sm ring-1 ring-border/50">
                  <Icon aria-hidden="true" className="size-3.5" />
                </span>
                <div
                  className="h-3 w-20 animate-pulse rounded-full bg-muted"
                  aria-hidden="true"
                />
              </div>
              <div
                className="h-6 w-10 animate-pulse rounded-full bg-background/80 ring-1 ring-border/60"
                aria-hidden="true"
              />
            </header>
            <div className="flex flex-col gap-2.5 p-2.5">
              {Array.from({ length: column.cards }).map((_, cardIndex) => {
                const [titleWidth, metaWidth] =
                  loadingCardLineWidths[cardIndex % loadingCardLineWidths.length]

                return (
                  <Card
                    key={`${column.id}-${cardIndex}`}
                    size="sm"
                    className="gap-3 bg-card/80 ring-border/60 shadow-sm"
                  >
                    <CardHeader className="gap-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-1 flex-col gap-2">
                          <div
                            className={cn(
                              "h-3 animate-pulse rounded-full bg-muted",
                              titleWidth
                            )}
                            aria-hidden="true"
                          />
                          <div
                            className="h-3 w-7/12 animate-pulse rounded-full bg-muted/70"
                            aria-hidden="true"
                          />
                        </div>
                        <div
                          className="h-5 w-16 animate-pulse rounded-full bg-muted/80"
                          aria-hidden="true"
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div
                          className="size-3.5 animate-pulse rounded-full bg-muted"
                          aria-hidden="true"
                        />
                        <div
                          className={cn(
                            "h-2.5 animate-pulse rounded-full bg-muted",
                            metaWidth
                          )}
                          aria-hidden="true"
                        />
                      </div>
                    </CardHeader>
                    {cardIndex === 0 ? (
                      <CardContent className="flex flex-col gap-2">
                        <div
                          className="h-2.5 w-full animate-pulse rounded-full bg-muted/70"
                          aria-hidden="true"
                        />
                        <div
                          className="h-2.5 w-9/12 animate-pulse rounded-full bg-muted/60"
                          aria-hidden="true"
                        />
                      </CardContent>
                    ) : null}
                    <CardFooter className="flex-wrap justify-between gap-2 border-t-0 bg-transparent">
                      <div
                        className="h-2.5 w-12 animate-pulse rounded-full bg-muted"
                        aria-hidden="true"
                      />
                      <div
                        className="h-2.5 w-8 animate-pulse rounded-full bg-muted/70"
                        aria-hidden="true"
                      />
                    </CardFooter>
                  </Card>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function GroupOptionContent({ option }: { option: SelectableGroupOption }) {
  const Icon = option.icon

  return (
    <span className="flex min-w-0 items-center gap-2">
      <Icon aria-hidden="true" className="shrink-0 text-muted-foreground" />
      <span className="truncate">{groupOptionLabel(option)}</span>
    </span>
  )
}

function AgentCardPreview({ agent }: { agent: AgentCard }) {
  const previewArtifact = getPreviewArtifact(agent.artifacts)
  const hasCardContent = Boolean(agent.latestMessage || previewArtifact)
  const statusMeta = getStatusMeta(agent.status)
  const artifactCount = agent.artifacts.length

  return (
    <Card
      size="sm"
      className="relative gap-3 bg-card/80 ring-border/60 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-card hover:shadow-lg hover:shadow-black/15 hover:ring-primary/25"
    >
      <div
        aria-hidden="true"
        className={cn("absolute inset-y-0 left-0 w-1 rounded-l-xl", statusMeta.dotClass)}
      />
      <CardHeader className="gap-2 pl-4">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="line-clamp-2 transition-colors group-hover/card:text-primary">
            {agent.title}
          </CardTitle>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <StatusBadge status={agent.status} />
            {artifactCount > 0 ? (
              <Badge variant="outline" className="gap-1 bg-muted/40 text-[0.65rem]">
                <FileIcon aria-hidden="true" className="size-3" />
                {artifactCount}
              </Badge>
            ) : null}
          </div>
        </div>
        <CardDescription className="flex items-center gap-1.5 truncate rounded-md bg-muted/35 px-2 py-1 text-xs">
          <GitBranchIcon aria-hidden="true" className="size-3.5 shrink-0" />
          {agent.repositoryUrl ? (
            <a
              href={agent.repositoryUrl}
              target="_blank"
              rel="noreferrer"
              className="truncate underline-offset-4 hover:text-foreground hover:underline"
            >
              {agent.repository}
            </a>
          ) : (
            <span className="truncate">{agent.repository}</span>
          )}
        </CardDescription>
        {agent.branch ? (
          <div className="flex min-w-0 items-center gap-1.5 rounded-md bg-muted/25 px-2 py-1 text-xs text-muted-foreground">
            <GitBranchIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{agent.branch}</span>
          </div>
        ) : null}
      </CardHeader>
      {hasCardContent ? (
        <CardContent className="flex flex-col gap-3 pl-4">
          {agent.latestMessage ? (
            <p className="line-clamp-2 rounded-lg border border-border/40 bg-muted/20 p-2 text-sm leading-5 text-muted-foreground">
              {agent.latestMessage}
            </p>
          ) : null}
          {previewArtifact ? <ArtifactTile artifact={previewArtifact} /> : null}
        </CardContent>
      ) : null}
      <CardFooter className="flex-wrap justify-between gap-2 border-t border-border/30 bg-muted/15 pl-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <ClockIcon aria-hidden="true" className="size-3" />
          {formatRelativeTime(agent.updatedAt ?? agent.createdAt)}
        </span>
        {typeof agent.durationMs === "number" ? (
          <span title="Run duration">{formatDuration(agent.durationMs)}</span>
        ) : null}
        {agent.createdBy ? (
          <span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-muted/50 px-1.5 py-0.5">
            <span className="shrink-0">By</span>
            <span className="truncate">{agent.createdBy}</span>
          </span>
        ) : null}
        {agent.prUrl ? (
          <a
            href={agent.prUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-primary underline-offset-4 hover:bg-primary/20"
          >
            <GitBranchIcon aria-hidden="true" className="size-3" />
            PR
          </a>
        ) : null}
      </CardFooter>
    </Card>
  )
}

function ArtifactTile({ artifact }: { artifact: AgentCard["artifacts"][number] }) {
  if (artifact.previewKind === "video" && artifact.mediaUrl) {
    return (
      <div className="overflow-hidden rounded-xl border border-border/50 bg-muted shadow-sm">
        <video
          src={artifact.mediaUrl}
          className="aspect-video w-full object-cover"
          muted
          loop
          playsInline
          controls
          preload="metadata"
        >
          {artifact.name}
        </video>
      </div>
    )
  }

  if (artifact.previewKind === "video") {
    return (
      <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border/40 bg-muted/40 p-2 text-xs">
        <PlayIcon
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <span className="truncate">{artifact.name}</span>
      </div>
    )
  }

  if (artifact.previewKind === "image" && artifact.mediaUrl) {
    return (
      <a
        href={artifact.mediaUrl}
        target="_blank"
        rel="noreferrer"
        className="group overflow-hidden rounded-xl border border-border/50 bg-muted shadow-sm"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- artifact media is served through an authenticated app route. */}
        <img
          src={artifact.mediaUrl}
          alt={artifact.name}
          className="aspect-video w-full object-cover transition-transform group-hover:scale-105"
        />
      </a>
    )
  }

  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border/40 bg-muted/40 p-2 text-xs">
      <FileIcon
        aria-hidden="true"
        className="size-3.5 shrink-0 text-muted-foreground"
      />
      <span className="truncate">{artifact.name}</span>
    </div>
  )
}

function CreateAgentDialog({
  sessionId,
  repositories,
  models,
  onClose,
  onCreated,
}: {
  sessionId: string
  repositories: RepositoryOption[]
  models: ModelOption[]
  onClose: () => void
  onCreated: (agent: AgentCard) => Promise<void>
}) {
  const [name, setName] = React.useState("")
  const [prompt, setPrompt] = React.useState("")
  const [repositoryId, setRepositoryId] = React.useState(repositories[0]?.id ?? "")
  const [modelId, setModelId] = React.useState(models[0]?.id ?? "")
  const [branch, setBranch] = React.useState(repositories[0]?.defaultBranch ?? "")
  const [autoCreatePR, setAutoCreatePR] = React.useState(true)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const selectedRepositoryId = repositoryId || repositories[0]?.id || ""
  const selectedRepository = repositories.find(
    (repository) => repository.id === selectedRepositoryId
  )
  const hasModels = models.length > 0
  const selectedModelId = modelId || models[0]?.id || ""
  const selectedModel = models.find((model) => model.id === selectedModelId)
  const promptWordCount = prompt.trim() ? prompt.trim().split(/\s+/).length : 0

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedName = name.trim()
    const trimmedPrompt = prompt.trim()
    const trimmedBranch = branch.trim()
    if (!trimmedPrompt) {
      setError("Add a prompt before creating a cloud agent.")
      return
    }
    if (!selectedRepositoryId) {
      setError("Select a repository before creating a cloud agent.")
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      const response = await apiFetch<CreateAgentResponse>("/api/agents", sessionId, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName || undefined,
          prompt: trimmedPrompt,
          repositoryId: selectedRepositoryId,
          ...(hasModels && selectedModelId ? { modelId: selectedModelId } : {}),
          branch: trimmedBranch || undefined,
          autoCreatePR,
        }),
      })
      await onCreated(response.agent)
      onClose()
    } catch (submitError) {
      setError(errorMessage(submitError, "Failed to create a cloud agent."))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex animate-in fade-in-0 items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <Card
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-agent-title"
        className="max-h-[90vh] w-full max-w-2xl animate-in zoom-in-95 slide-in-from-bottom-2 border-border/70 bg-card/95 shadow-2xl shadow-black/15"
      >
        <CardHeader className="border-b">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle id="create-agent-title">Create cloud agent</CardTitle>
              <CardDescription>
                Start a Cursor Cloud Agent from a repository and prompt.
              </CardDescription>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
              <XIcon />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            <label className="flex flex-col gap-2 text-sm font-medium">
              Title
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Triage checkout bug"
                className="bg-background/60"
              />
            </label>

            <div className={cn("grid gap-4 rounded-2xl border border-border/50 bg-muted/20 p-3", hasModels && "md:grid-cols-2")}>
              <label className="flex flex-col gap-2 text-sm font-medium">
                Repository
                <Select
                  items={repositories.map((repository) => ({
                    label: repository.label,
                    value: repository.id,
                  }))}
                  value={selectedRepositoryId}
                  onValueChange={(value) => {
                    if (value) {
                      const nextRepository = repositories.find(
                        (repository) => repository.id === value
                      )
                      setRepositoryId(value)
                      if (nextRepository?.defaultBranch) {
                        setBranch((current) =>
                          current.trim() ? current : nextRepository.defaultBranch ?? ""
                        )
                      }
                    }
                  }}
                >
                  <SelectTrigger aria-label="Repository" className="w-full bg-background/60">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectGroup>
                      {repositories.map((repository) => (
                        <SelectItem key={repository.id} value={repository.id}>
                          {repository.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </label>

              {hasModels ? (
                <label className="flex flex-col gap-2 text-sm font-medium">
                  Model
                  <Select
                    items={models.map((model) => ({
                      label: model.label,
                      value: model.id,
                    }))}
                    value={selectedModelId}
                    onValueChange={(value) => {
                      if (value) {
                        setModelId(value)
                      }
                    }}
                  >
                    <SelectTrigger aria-label="Model" className="w-full bg-background/60">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start">
                      <SelectGroup>
                        {models.map((model) => (
                          <SelectItem key={model.id} value={model.id}>
                            {model.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {selectedModel?.description ? (
                    <span className="text-xs font-normal text-muted-foreground">
                      {selectedModel.description}
                    </span>
                  ) : null}
                </label>
              ) : null}
            </div>

            <label className="flex flex-col gap-2 text-sm font-medium">
              Branch or starting ref
              <Input
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                placeholder={selectedRepository?.defaultBranch ?? "main"}
                className="bg-background/60"
              />
              {selectedRepository?.defaultBranch ? (
                <span className="text-xs font-normal text-muted-foreground">
                  Default branch: {selectedRepository.defaultBranch}
                </span>
              ) : null}
            </label>

            <label className="flex flex-col gap-2 text-sm font-medium">
              Prompt
              <Textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Ask the agent to investigate, implement, or review..."
                className="min-h-32 bg-background/60"
                required
              />
              <span className="text-xs font-normal text-muted-foreground">
                {promptWordCount} word{promptWordCount === 1 ? "" : "s"} ·{" "}
                {prompt.length} character{prompt.length === 1 ? "" : "s"}
              </span>
            </label>

            <label className="flex items-center gap-2 rounded-xl border border-border/50 bg-muted/25 p-3 text-sm text-muted-foreground">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={autoCreatePR}
                onChange={(event) => setAutoCreatePR(event.target.checked)}
              />
              Auto-create a pull request when the agent completes
            </label>

            {repositories.length === 0 ? (
              <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                No repositories were returned by the SDK. Check your Cursor and
                GitHub integration permissions.
              </div>
            ) : null}

            {error ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!prompt.trim() || !selectedRepositoryId || isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <CircleNotchIcon data-icon="inline-start" className="animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create agent"
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function SidebarItem({
  active,
  collapsed = false,
  count,
  icon: Icon,
  label,
  onSelect,
}: {
  active: boolean
  collapsed?: boolean
  count: number
  icon: IconComponent
  label: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={collapsed ? `${label}: ${count}` : undefined}
      onClick={onSelect}
      title={collapsed ? `${label}: ${count}` : undefined}
      className={cn(
        "relative flex w-full items-center gap-2 rounded-xl text-muted-foreground transition-all outline-none hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4 [&_svg]:shrink-0",
        collapsed ? "size-11 justify-center p-0" : "px-2.5 py-2 text-left",
        active && "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm ring-1 ring-sidebar-border/60"
      )}
    >
      <Icon aria-hidden="true" />
      {collapsed ? (
        <Badge
          variant={active ? "secondary" : "outline"}
          className="absolute -right-1 -top-1 h-4 min-w-4 px-1 text-[0.65rem]"
        >
          {count}
        </Badge>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <Badge variant={active ? "secondary" : "outline"}>{count}</Badge>
        </>
      )}
    </button>
  )
}

function EmptyBoard({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex min-h-[50vh] flex-1 items-center justify-center">
      <div className="flex w-full max-w-md flex-col items-center gap-5 rounded-3xl border border-border/60 bg-card/60 p-8 text-center shadow-sm backdrop-blur-sm">
        <div className="flex size-16 items-center justify-center rounded-3xl border border-primary/20 bg-primary/10 shadow-sm">
          <RocketLaunchIcon aria-hidden="true" className="size-8 text-primary" />
        </div>
        <div>
          <h2 className="text-lg font-semibold tracking-tight">No agents yet</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Create a cloud agent to populate the board with status columns,
            artifact previews, and pull request links.
          </p>
        </div>
        <Button onClick={onCreate} size="sm">
          <PlusIcon data-icon="inline-start" />
          New agent
        </Button>
      </div>
    </div>
  )
}

function FilteredEmptyBoard({
  query,
  filterLabel,
  onClear,
}: {
  query: string
  filterLabel?: string
  onClear: () => void
}) {
  const hasQuery = Boolean(query.trim())

  return (
    <div className="flex min-h-[50vh] flex-1 items-center justify-center">
      <div className="flex w-full max-w-md flex-col items-center gap-5 rounded-3xl border border-border/60 bg-card/60 p-8 text-center shadow-sm backdrop-blur-sm">
        <div className="flex size-16 items-center justify-center rounded-3xl border border-border/60 bg-muted/40 shadow-sm">
          <MagnifyingGlassIcon
            aria-hidden="true"
            className="size-8 text-muted-foreground/60"
          />
        </div>
        <div>
          <h2 className="text-lg font-semibold tracking-tight">No matching agents</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {hasQuery ? (
              <>
                No agents match{" "}
                <span className="font-medium text-foreground">
                  &quot;{query.trim()}&quot;
                </span>
                .
              </>
            ) : (
              "No agents match the selected filter."
            )}
            {filterLabel ? ` Filter: ${filterLabel}.` : ""}
          </p>
        </div>
        <Button onClick={onClear} size="sm" variant="outline">
          <XIcon data-icon="inline-start" />
          Clear search and filters
        </Button>
      </div>
    </div>
  )
}

type StatusMeta = {
  dotClass: string
  textClass: string
  bgClass: string
  icon: IconComponent
  pulse: boolean
}

function getStatusMeta(status: string): StatusMeta {
  const n = status.toLowerCase()

  if (n.includes("fail") || n.includes("error") || n.includes("cancel")) {
    return {
      dotClass: "bg-red-400",
      textClass: "text-red-400",
      bgClass: "bg-red-500/12",
      icon: XCircleIcon,
      pulse: false,
    }
  }
  if (n.includes("complete") || n.includes("done") || n.includes("success") || n.includes("finish")) {
    return {
      dotClass: "bg-emerald-400",
      textClass: "text-emerald-400",
      bgClass: "bg-emerald-500/12",
      icon: CheckCircleIcon,
      pulse: false,
    }
  }
  if (n.includes("run") || n.includes("progress") || n.includes("active") || n.includes("work")) {
    return {
      dotClass: "bg-blue-400",
      textClass: "text-blue-400",
      bgClass: "bg-blue-500/12",
      icon: CircleNotchIcon,
      pulse: true,
    }
  }
  if (n.includes("queue") || n.includes("wait") || n.includes("pending") || n.includes("schedul")) {
    return {
      dotClass: "bg-amber-400",
      textClass: "text-amber-400",
      bgClass: "bg-amber-500/12",
      icon: HourglassIcon,
      pulse: false,
    }
  }

  return {
    dotClass: "bg-muted-foreground/40",
    textClass: "text-muted-foreground",
    bgClass: "bg-muted/40",
    icon: CircleDashedIcon,
    pulse: false,
  }
}

function StatusBadge({ status }: { status: string }) {
  const meta = getStatusMeta(status)
  const label = formatStatusLabel(status)
  const Icon = meta.icon

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        meta.bgClass,
        meta.textClass
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("size-3.5 shrink-0", meta.pulse && "animate-spin")}
      />
      {label}
    </span>
  )
}

function groupAgents(agents: AgentCard[], groupBy: GroupBy) {
  const groups = new Map<string, AgentCard[]>()

  for (const agent of agents) {
    const title = groupTitle(agent, groupBy)
    const group = groups.get(title) ?? []
    group.push(agent)
    groups.set(title, group)
  }

  const entries = Array.from(groups.entries())
  if (groupBy === "createdAt") {
    entries.sort(
      ([leftTitle], [rightTitle]) => dateBucketRank(leftTitle) - dateBucketRank(rightTitle)
    )
  }

  return entries.map(([title, group]) => ({
    id: `${groupBy}-${title}`,
    title,
    agents: group,
  }))
}

function dateBucketRank(title: string) {
  return dateBucketOrder.get(title) ?? dateBucketOrder.size
}

function groupTitle(agent: AgentCard, groupBy: GroupBy) {
  if (groupBy === "createdAt") {
    return dateBucket(agent.createdAt)
  }

  const value = agent[groupBy]
  if (groupBy === "status" && typeof value === "string" && value.trim()) {
    return formatStatusLabel(value)
  }

  return typeof value === "string" && value.trim() ? value : "Unassigned"
}

function searchAgents(agents: AgentCard[], query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return agents
  }

  return agents.filter((agent) =>
    [
      agent.title,
      agent.status,
      agent.repository,
      agent.branch,
      agent.createdBy,
      agent.latestMessage,
    ]
      .filter(Boolean)
      .some((value) => value?.toLowerCase().includes(normalizedQuery))
  )
}

function filterAgentsBySidebar(agents: AgentCard[], filter: SidebarFilter) {
  if (filter === "withArtifacts") {
    return agents.filter((agent) => agent.artifacts.length > 0)
  }

  if (filter === "prAgents") {
    return agents.filter((agent) => Boolean(agent.prUrl))
  }

  if (filter === "recentlyActive") {
    return agents.filter((agent) => isRecentlyActive(agent.updatedAt ?? agent.createdAt))
  }

  return agents
}

function getBoardStats(allAgents: AgentCard[], visibleAgents: AgentCard[]) {
  return {
    activeCount: visibleAgents.filter((agent) =>
      ["run", "progress", "active", "work"].some((token) =>
        agent.status.toLowerCase().includes(token)
      )
    ).length,
    artifactCount: visibleAgents.filter((agent) => agent.artifacts.length > 0).length,
    prCount: allAgents.filter((agent) => Boolean(agent.prUrl)).length,
  }
}

function mergeAgentLists(current: AgentCard[], incoming: AgentCard[]) {
  const byId = new Map(current.map((agent) => [agent.id, agent]))

  for (const agent of incoming) {
    byId.set(agent.id, agent)
  }

  return Array.from(byId.values())
}

function isRecentlyActive(value: string | undefined) {
  if (!value) {
    return false
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return false
  }

  const diffMs = Date.now() - date.getTime()
  return diffMs >= 0 && diffMs <= 86_400_000
}

function getPreviewArtifact(artifacts: AgentCard["artifacts"]) {
  return (
    artifacts.find((artifact) => artifact.previewKind === "video") ??
    artifacts[0] ??
    null
  )
}

async function apiFetch<T>(
  input: string,
  sessionId: string,
  init: RequestInit = {}
): Promise<T> {
  return fetchJson<T>(input, {
    ...init,
    headers: {
      ...init.headers,
      "x-agent-kanban-session": sessionId,
    },
  })
}

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)
  const payload = (await response.json().catch(() => ({}))) as ApiError

  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed with ${response.status}.`)
  }

  return payload as T
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function getSelectableGroupOptions(agents: AgentCard[]): SelectableGroupOption[] {
  return groupOptions.map((option) => {
    const requiredField = option.requiresData

    return {
      ...option,
      selectable:
        agents.length === 0 ||
        !requiredField ||
        agents.some((agent) => hasAgentValue(agent, requiredField)),
    }
  })
}

function hasAgentValue(agent: AgentCard, field: keyof AgentCard) {
  const value = agent[field]
  if (typeof value === "string") {
    return Boolean(value.trim())
  }

  return value !== undefined && value !== null
}

function groupOptionLabel(option: SelectableGroupOption) {
  return option.selectable ? option.label : `${option.label} (no data)`
}

function isSelectableGroupBy(
  value: string | null,
  options: SelectableGroupOption[]
): value is GroupBy {
  return options.some((option) => option.id === value && option.selectable)
}

function titleCase(value: string) {
  return value
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatStatusLabel(value: string) {
  const normalized = value.trim().toLowerCase()
  if (!normalized || normalized === "unknown" || normalized === "no_status") {
    return "No status"
  }

  return titleCase(value)
}

function dateBucket(value: string | undefined) {
  if (!value) {
    return "No date"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "No date"
  }

  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / 86_400_000)

  if (diffDays <= 0) {
    return "Today"
  }
  if (diffDays === 1) {
    return "Yesterday"
  }
  if (diffDays < 7) {
    return "This week"
  }
  if (diffDays < 30) {
    return "This month"
  }
  return "Older"
}

function formatAbsoluteTime(value: number | string) {
  const date = typeof value === "number" ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "unknown time"
  }
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  })
}

function formatRelativeTimestamp(value: number) {
  const diffMs = Date.now() - value
  const minutes = Math.max(1, Math.floor(diffMs / 60_000))
  if (minutes < 60) {
    return `${minutes}m ago`
  }

  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }

  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatRelativeTime(value: string | undefined) {
  if (!value) {
    return "No activity"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "No activity"
  }

  const diffMs = Date.now() - date.getTime()
  const minutes = Math.max(1, Math.floor(diffMs / 60_000))
  if (minutes < 60) {
    return `${minutes}m ago`
  }

  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }

  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatDuration(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return "Unknown duration"
  }

  const seconds = Math.round(value / 1000)
  if (seconds < 60) {
    return `${seconds}s`
  }

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}
