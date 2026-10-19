-- CityMap.applescript — the "City Map.app" front end (compiled by build-app.sh).
--
-- PURPOSE  Click the icon → the map opens in your browser. A stay-open applet, so the
--          app sits in the Dock while the map server runs, and quitting it (Dock → Quit,
--          or ⌘Q) stops the server it started.
--          All process work is in citymap-ctl.sh (Contents/Resources); this file is only
--          GUI: notifications, dialogs, opening the URL.
--
-- FLOW     run    → ctl start → "ready <url>" → open it
--                              → "starting <url>" → idle polls ctl check every 2 s → open it
--          reopen (Dock icon clicked again) → open the map again, or say it is still starting
--          quit   → ctl stop  (only a server this app launched; Docker keeps running)
--
-- TRAP     Script globals in an applet are saved back into the bundle when it quits,
--          which would rewrite the app's files. Everything is reset in `run`, and the
--          state that matters (pid, port) lives in citymap-ctl.sh's files, not here.

global ctl, mapURL, mapOpened, waitedSeconds, warnedSlow

-- ADJUSTABLE: seconds between "is it up yet?" checks while starting.
property pollSeconds : 2
-- ADJUSTABLE: after this long, ask whether to keep waiting. A first launch (Docker Desktop
-- cold start + building the map with npm) can take several minutes; later launches ~15 s.
property slowSeconds : 600

-- O(1) time, O(1) space — n = 1 ctl call
on run
	set ctl to quoted form of (POSIX path of (path to me) & "Contents/Resources/citymap-ctl.sh")
	set mapURL to ""
	set mapOpened to false
	set waitedSeconds to 0
	set warnedSlow to false
	try
		set reply to do shell script ctl & " start"
	on error errMsg
		display alert "City Map can't start" message errMsg as critical buttons {"Quit"} default button "Quit"
		quit
		return
	end try
	set mapURL to text ((offset of " " in reply) + 1) thru -1 of reply
	if reply starts with "ready" then
		openMap()
	else
		display notification "Starting the map server… the first launch can take a few minutes." with title "City Map"
	end if
end run

-- Dock icon clicked while running. Never trust the cached URL: the server may have died
-- (or a reused Terminal server been stopped) since it opened, so ask ctl again — `start`
-- relaunches it if needed and idle resumes polling.
-- O(1) time, O(1) space — n = 1 ctl call
on reopen
	if not mapOpened then
		display notification "Still starting — the map opens as soon as it's ready." with title "City Map"
		return
	end if
	try
		set reply to do shell script ctl & " start"
	on error errMsg
		display alert "City Map can't start" message errMsg as critical
		return
	end try
	set mapURL to text ((offset of " " in reply) + 1) thru -1 of reply
	if reply starts with "ready" then
		openMap()
	else
		set mapOpened to false
		set waitedSeconds to 0
		set warnedSlow to false
		display notification "The map server had stopped — restarting it…" with title "City Map"
	end if
end reopen

-- O(1) time, O(1) space — n = 1 ctl call per tick
on idle
	if mapOpened then return 60
	try
		set reply to do shell script ctl & " check"
	on error
		return pollSeconds
	end try
	if reply starts with "ready" then
		set mapURL to text ((offset of " " in reply) + 1) thru -1 of reply
		openMap()
		return 60
	else if reply starts with "failed" then
		set logPath to text ((offset of " " in reply) + 1) thru -1 of reply
		set choice to button returned of (display alert "City Map didn't start" message "The map server stopped before it was ready. The log usually says why (Docker not running, a missing setup step…)." as critical buttons {"Quit", "Show Log"} default button "Show Log")
		if choice is "Show Log" then do shell script "open -a Console " & quoted form of logPath
		quit
		return 60
	end if
	set waitedSeconds to waitedSeconds + pollSeconds
	if waitedSeconds ≥ slowSeconds and not warnedSlow then
		set warnedSlow to true
		set choice to button returned of (display alert "City Map is taking a while" message "The server is still starting. Keep waiting?" buttons {"Stop", "Show Log", "Keep Waiting"} default button "Keep Waiting")
		if choice is "Stop" then
			quit
		else if choice is "Show Log" then
			do shell script "open -a Console " & quoted form of (do shell script ctl & " log")
		end if
	end if
	return pollSeconds
end idle

-- O(1) time, O(1) space — n = 1 ctl call
on quit
	try
		do shell script ctl & " stop"
	end try
	continue quit
end quit

-- O(1) time, O(1) space — n = 1 URL
on openMap()
	set mapOpened to true
	open location mapURL
end openMap
