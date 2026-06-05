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
  const [query, setQuery] = React.useState("")
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [isCreateOpen, setIsCreateOpen] = React.useState(false)
  const [isShortcutsOpen, setIsShortcutsOpen] = React.useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = React.useState(
    () => readStoredPreferences().isSidebarCollapsed ?? false
  )
  const [lastSyncedAt, setLastSyncedAt] = React.useState<number | null>(null)
  const searchInputRef = React.useRef<HTMLInputElement>(null)

  const loadBoard = React.useCallback(async (sessionId: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const [agentResult, repositoryResult, modelResult] = await Promise.all([
        apiFetch<AgentListResponse>("/api/agents", sessionId),
        apiFetch<{ repositories: RepositoryOption[] }>(
          "/api/repositories",
          sessionId
        ),
        apiFetch<{ models: ModelOption[] }>("/api/models", sessionId),
      ])
      setAgents(agentResult.agents)
      setRepositories(repositoryResult.repositories)
      setModels(modelResult.models)
      setLastSyncedAt(Date.now())
    } catch (loadError) {
      setError(errorMessage(loadError, "Failed to load cloud agents."))
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Silent background refresh used by polling and visibility changes.
  // Doesn't toggle isLoading or surface errors so the user can keep working
  // with whatever data is already on the board.
  const refreshAgentsQuietly = React.useCallback(async (sessionId: string) => {
    try {
      const result = await apiFetch<AgentListResponse>("/api/agents", sessionId)
      setAgents(result.agents)
      setLastSyncedAt(Date.now())
    } catch {
      // Intentionally swallowed; manual refresh will surface errors loudly.
    }
  }, [])

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
        await loadBoard(restored.id)
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
      void refreshAgentsQuietly(sessionId)
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
  }, [status, session, refreshAgentsQuietly])

  async function handleSessionCreated(nextSession: PublicSession) {
    window.localStorage.setItem(sessionStorageKey, nextSession.id)
    setSession(nextSession)
    setStatus("ready")
    await loadBoard(nextSession.id)
  }

  const handleRefresh = React.useCallback(async () => {
    if (!session) {
      return
    }
    await loadBoard(session.id)
  }, [session, loadBoard])

  async function handleForgetKey() {
    window.localStorage.removeItem(sessionStorageKey)
    window.localStorage.removeItem(preferencesStorageKey)
    await fetch("/api/session", { method: "DELETE" })
    setSession(null)
    setAgents([])
    setRepositories([])
    setModels([])
    setLastSyncedAt(null)
    setStatus("onboarding")
  }

  async function handleAgentCreated(agent: AgentCard) {
    setAgents((current) => [agent, ...current])
    if (session) {
      await loadBoard(session.id)
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
    })
  }, [status, groupBy, sidebarFilter, isSidebarCollapsed])

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
  }, [status, isCreateOpen, isShortcutsOpen, query, handleRefresh])

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
  const signedInName = session.user?.name ?? "Cursor user"
  const signedInLabel = session.user?.email
    ? `${signedInName} (${session.user.email})`
    : signedInName
  const signedInInitial = signedInName.trim().charAt(0).toUpperCase() || "C"

  return (
    <div className="flex h-screen min-h-0 bg-background text-foreground">
      <aside
        className={cn(
          "hidden shrink-0 border-r bg-sidebar/70 transition-[width] duration-200 lg:flex lg:flex-col",
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
              <div className="flex size-7 items-center justify-center rounded-lg bg-primary shadow-sm shadow-primary/40 text-primary-foreground">
                <KanbanIcon aria-hidden="true" className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">Agent Kanban</div>
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
            "flex flex-1 flex-col gap-1 text-sm",
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
            <div className="rounded-lg border bg-background/60 p-3">
              <div className="text-xs font-medium text-muted-foreground">Signed in</div>
              <div className="mt-1 truncate text-sm">{signedInName}</div>
              {session.user?.email ? (
                <div className="truncate text-xs text-muted-foreground">
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
        className="flex min-w-0 flex-1 flex-col outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset"
      >
        <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur-sm">
          <div className="relative flex min-w-48 flex-1 items-center">
            <MagnifyingGlassIcon
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground"
            />
            <Input
              ref={searchInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search agents and repos..."
              aria-label="Search agents and repositories"
              className="h-8 border-0 bg-muted/60 pl-8 pr-10"
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
                className="absolute right-0.5 size-7"
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
            <SelectTrigger aria-label="Group agents" size="sm">
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

          <div className="hidden shrink-0 items-center gap-2 text-xs text-muted-foreground xl:flex">
            <span>{visibleAgents.length} agent{visibleAgents.length !== 1 ? "s" : ""}</span>
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
          <div className="shrink-0 xl:hidden">
            {isLoading ? (
              <CircleNotchIcon aria-hidden="true" className="size-4 animate-spin text-primary" />
            ) : null}
          </div>

          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isLoading}>
            <ArrowClockwiseIcon data-icon="inline-start" className={isLoading ? "animate-spin" : ""} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setIsCreateOpen(true)}>
            <PlusIcon data-icon="inline-start" />
            New agent
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
          <div className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <section className="flex min-h-0 flex-1 flex-col">
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex min-h-full gap-3 p-4">
              {groups.length > 0 ? (
                groups.map((group) => (
                  <BoardColumn
                    key={group.id}
                    title={group.title}
                    icon={selectedGroupOption?.icon ?? CirclesFourIcon}
                    agents={group.agents}
                  />
                ))
              ) : showBoardLoading ? (
                <BoardLoadingSkeleton />
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
      className="fixed inset-0 z-40 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <Card
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="w-full max-w-sm shadow-2xl"
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

function LoadingScreen() {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,oklch(0.68_0.18_264_/_0.12),transparent)]"
      />
      <div className="relative flex flex-col items-center gap-4 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/30">
          <KanbanIcon aria-hidden="true" className="size-7 text-primary-foreground" />
        </div>
        <div>
          <div className="flex items-center justify-center gap-2 text-sm font-medium text-foreground">
            <CircleNotchIcon aria-hidden="true" className="size-4 animate-spin text-primary" />
            Loading Agent Kanban
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Checking for a saved API key…</p>
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
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,oklch(0.68_0.18_264_/_0.18),transparent)]"
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary shadow-lg shadow-primary/30">
            <KanbanIcon aria-hidden="true" className="size-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Agent Kanban</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A kanban board for your Cursor Cloud Agents
          </p>
        </div>
        <Card className="border border-border/60 bg-card/90 shadow-2xl backdrop-blur-sm">
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
              <label className="flex items-start gap-2 text-sm text-muted-foreground">
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
    <section className="flex w-80 shrink-0 flex-col rounded-xl border border-border/40 bg-muted/10">
      <header className="flex items-center justify-between rounded-t-xl border-b border-border/40 bg-muted/20 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex size-5 items-center justify-center rounded-md bg-background/60">
            <Icon aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
          </span>
          <h2 className="truncate text-sm font-semibold">{title}</h2>
        </div>
        <span className="flex size-5 items-center justify-center rounded-full bg-background/60 text-xs font-medium text-muted-foreground ring-1 ring-border/60">
          {agents.length}
        </span>
      </header>
      <div className="flex flex-col gap-2 p-2">
        {agents.map((agent) => (
          <AgentCardPreview key={agent.id} agent={agent} />
        ))}
      </div>
    </section>
  )
}

function BoardLoadingSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading cloud agents"
      className="flex min-h-[60vh] flex-1 gap-3"
    >
      <span className="sr-only">Loading cloud agents</span>
      {boardLoadingColumns.map((column) => {
        const Icon = column.icon

        return (
          <section
            key={column.id}
            className="flex w-80 shrink-0 flex-col rounded-xl border bg-muted/20 shadow-sm"
          >
            <header className="flex items-center justify-between px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex size-5 items-center justify-center rounded-md bg-background/70 text-muted-foreground">
                  <Icon aria-hidden="true" className="size-3.5" />
                </span>
                <div
                  className="h-3 w-20 animate-pulse rounded-full bg-muted"
                  aria-hidden="true"
                />
              </div>
              <div
                className="h-5 w-8 animate-pulse rounded-full bg-background/80 ring-1 ring-border/60"
                aria-hidden="true"
              />
            </header>
            <div className="flex flex-col gap-2 p-2">
              {Array.from({ length: column.cards }).map((_, cardIndex) => {
                const [titleWidth, metaWidth] =
                  loadingCardLineWidths[cardIndex % loadingCardLineWidths.length]

                return (
                  <Card
                    key={`${column.id}-${cardIndex}`}
                    size="sm"
                    className="gap-3 bg-card/70 ring-border/60"
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

  return (
    <Card
      size="sm"
      className="relative gap-3 bg-card/70 ring-border/60 transition-all hover:bg-card hover:-translate-y-px hover:shadow-md hover:shadow-black/20"
    >
      <div
        aria-hidden="true"
        className={cn("absolute inset-y-0 left-0 w-[3px] rounded-l-xl", statusMeta.dotClass)}
      />
      <CardHeader className="gap-2 pl-4">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="line-clamp-2">{agent.title}</CardTitle>
          <StatusBadge status={agent.status} />
        </div>
        <CardDescription className="flex items-center gap-1.5 truncate text-xs">
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
      </CardHeader>
      {hasCardContent ? (
        <CardContent className="flex flex-col gap-3 pl-4">
          {agent.latestMessage ? (
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {agent.latestMessage}
            </p>
          ) : null}
          {previewArtifact ? <ArtifactTile artifact={previewArtifact} /> : null}
        </CardContent>
      ) : null}
      <CardFooter className="flex-wrap justify-between gap-2 border-t-0 bg-transparent pl-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <ClockIcon aria-hidden="true" className="size-3" />
          {formatRelativeTime(agent.updatedAt ?? agent.createdAt)}
        </span>
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
      <div className="overflow-hidden rounded-lg bg-muted">
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
      <div className="flex min-w-0 items-center gap-2 rounded-lg bg-muted/40 p-2 text-xs">
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
        className="group overflow-hidden rounded-lg bg-muted"
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
    <div className="flex min-w-0 items-center gap-2 rounded-lg bg-muted/40 p-2 text-xs">
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
  const [branch, setBranch] = React.useState("")
  const [autoCreatePR, setAutoCreatePR] = React.useState(true)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const selectedRepositoryId = repositoryId || repositories[0]?.id || ""
  const hasModels = models.length > 0
  const selectedModelId = modelId || models[0]?.id || ""

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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <Card
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-agent-title"
        className="max-h-[90vh] w-full max-w-2xl shadow-2xl"
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
              />
            </label>

            <div className={cn("grid gap-4", hasModels && "md:grid-cols-2")}>
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
                      setRepositoryId(value)
                    }
                  }}
                >
                  <SelectTrigger aria-label="Repository" className="w-full">
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
                    <SelectTrigger aria-label="Model" className="w-full">
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
                </label>
              ) : null}
            </div>

            <label className="flex flex-col gap-2 text-sm font-medium">
              Branch or starting ref
              <Input
                value={branch}
                onChange={(event) => setBranch(event.target.value)}
                placeholder="main"
              />
            </label>

            <label className="flex flex-col gap-2 text-sm font-medium">
              Prompt
              <Textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Ask the agent to investigate, implement, or review..."
                className="min-h-32"
                required
              />
            </label>

            <label className="flex items-center gap-2 text-sm text-muted-foreground">
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
                {isSubmitting ? "Creating..." : "Create agent"}
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
        "relative flex w-full items-center gap-2 rounded-lg text-muted-foreground transition-all outline-none hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4 [&_svg]:shrink-0",
        collapsed ? "size-11 justify-center p-0" : "px-2 py-1.5 text-left",
        active && "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
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
      <div className="flex w-full max-w-sm flex-col items-center gap-5 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl border border-border/60 bg-card/80 shadow-sm">
          <RocketLaunchIcon aria-hidden="true" className="size-8 text-muted-foreground/60" />
        </div>
        <div>
          <h2 className="text-base font-semibold">No agents yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a cloud agent or adjust your search to populate the board.
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

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        meta.bgClass,
        meta.textClass
      )}
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          meta.dotClass,
          meta.pulse && "animate-pulse"
        )}
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
