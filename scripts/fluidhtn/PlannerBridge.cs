using System;
using System.Collections.Generic;
using System.Runtime.InteropServices.JavaScript;
using FluidHTN;
using FluidHTN.Contexts;
using FluidHTN.Compounds;
using FluidHTN.Factory;
using FluidHTN.Debug;
using TaskStatus = FluidHTN.TaskStatus;

namespace FluidHtnWasm;

public static partial class PlannerBridge
{
    [JSExport]
    public static string RunDemo()
    {
        var ctx = new MyContext();
        var planner = new Planner<MyContext>();
        ctx.Init();

        var executedTaskNames = new List<string>();

        var domain = new DomainBuilder<MyContext>("DemoDomain")
            .Select("Get C if A and B")
                .Condition("Has A and B", c => c.HasState(MyWorldState.HasA) && c.HasState(MyWorldState.HasB))
                .Condition("Does not have C", c => !c.HasState(MyWorldState.HasC))
                .Action("Get C")
                    .Do(c => { executedTaskNames.Add("Get C"); return TaskStatus.Success; })
                    .Effect("Set C", EffectType.PlanAndExecute, (c, type) => c.SetState(MyWorldState.HasC, true, type))
                .End()
            .End()
            .Sequence("Ensure A then B")
                .Condition("Missing A or B", c => !(c.HasState(MyWorldState.HasA) && c.HasState(MyWorldState.HasB)))
                .Action("Get A")
                    .Do(c => { executedTaskNames.Add("Get A"); return TaskStatus.Success; })
                    .Effect("Set A", EffectType.PlanAndExecute, (c, type) => c.SetState(MyWorldState.HasA, true, type))
                .End()
                .Action("Get B")
                    .Condition("Has A", c => c.HasState(MyWorldState.HasA))
                    .Do(c => { executedTaskNames.Add("Get B"); return TaskStatus.Success; })
                    .Effect("Set B", EffectType.PlanAndExecute, (c, type) => c.SetState(MyWorldState.HasB, true, type))
                .End()
            .End()
            .Select("Done")
                .Action("Done")
                    .Do(c => { executedTaskNames.Add("Done"); c.Done = true; return TaskStatus.Continue; })
                .End()
            .End()
            .Build();

        while (!ctx.Done)
        {
            planner.Tick(domain, ctx);
        }

        return string.Join(",", executedTaskNames);
    }

    public enum MyWorldState : byte { HasA, HasB, HasC }

    public class MyContext : BaseContext
    {
        public override List<string>? MTRDebug { get; set; }
        public override List<string>? LastMTRDebug { get; set; }
        public override bool DebugMTR { get; } = false;
        public override Queue<IBaseDecompositionLogEntry>? DecompositionLog { get; set; }
        public override bool LogDecomposition { get; } = false;

        public override IFactory Factory { get; protected set; } = new DefaultFactory();
        public override IPlannerState PlannerState { get; protected set; } = new DefaultPlannerState();

        private readonly byte[] _world = new byte[Enum.GetValues(typeof(MyWorldState)).Length];
        public override byte[] WorldState => _world;

        public bool Done { get; set; }

        public override void Init() => base.Init();

        public bool HasState(MyWorldState state) => HasState((int)state, 1);
        public void SetState(MyWorldState state, bool value, EffectType type)
            => SetState((int)state, (byte)(value ? 1 : 0), true, type);
    }

    // Bunker planner (string plan lines for easy JS parsing)
    // Returns lines like:
    //   MOVE table_area
    //   PICKUP_KEY
    //   MOVE storage_door
    //   UNLOCK_STORAGE
    //   MOVE c4_table
    //   PICKUP_C4
    //   MOVE bunker_door
    //   PLACE_C4
    //   MOVE safe_spot
    //   DETONATE
    //   MOVE star_pos
    //   PICKUP_STAR
    [JSExport]
    public static string PlanBunker()
    {
        var world = new BunkerWorld();
        var steps = new List<string>();

        void MoveTo(string target)
        {
            var path = BunkerWorld.FindPath(world, world.AgentAt, target);
            if (path != null)
            {
                for (var i = 1; i < path.Count; i++)
                {
                    steps.Add($"MOVE {path[i]}");
                    world.AgentAt = path[i];
                }
            }
        }

        // Acquire key
        MoveTo(BunkerWorld.Nodes.TableArea);
        steps.Add("PICKUP_KEY");
        world.HasKey = true;
        world.KeyOnTable = false;

        // Acquire C4
        MoveTo(BunkerWorld.Nodes.StorageDoor);
        if (!world.StorageUnlocked)
        {
            steps.Add("UNLOCK_STORAGE");
            world.StorageUnlocked = true;
        }
        MoveTo(BunkerWorld.Nodes.C4Table);
        steps.Add("PICKUP_C4");
        world.HasC4 = true;
        world.C4Available = false;

        // Breach
        MoveTo(BunkerWorld.Nodes.BunkerDoor);
        steps.Add("PLACE_C4");
        world.HasC4 = false;
        world.C4Placed = true;
        MoveTo(BunkerWorld.Nodes.SafeSpot);
        steps.Add("DETONATE");
        world.BunkerBreached = true;
        world.C4Placed = false;

        // Get star
        MoveTo(BunkerWorld.Nodes.StarPos);
        steps.Add("PICKUP_STAR");
        world.HasStar = true;
        world.StarPresent = false;

        return string.Join("\n", steps);
    }

    private sealed class BunkerWorld
    {
        public static class Nodes
        {
            public const string Courtyard = "courtyard";
            public const string TableArea = "table_area";
            public const string StorageDoor = "storage_door";
            public const string StorageInterior = "storage_interior";
            public const string C4Table = "c4_table";
            public const string BunkerDoor = "bunker_door";
            public const string BunkerInterior = "bunker_interior";
            public const string StarPos = "star_pos";
            public const string SafeSpot = "safe_spot";
        }

        // World facts / inventory
        public string AgentAt { get; set; } = Nodes.Courtyard;
        public bool KeyOnTable { get; set; } = true;
        public bool C4Available { get; set; } = true;
        public bool StarPresent { get; set; } = true;
        public bool HasKey { get; set; } = false;
        public bool HasC4 { get; set; } = false;
        public bool HasStar { get; set; } = false;
        public bool StorageUnlocked { get; set; } = false;
        public bool C4Placed { get; set; } = false;
        public bool BunkerBreached { get; set; } = false;

        private static readonly (string a, string b, Func<BunkerWorld, bool> allowed)[] RawEdges = new[]
        {
            (Nodes.Courtyard, Nodes.TableArea,      (Func<BunkerWorld, bool>)(_ => true)),
            (Nodes.Courtyard, Nodes.StorageDoor,    _ => true),
            (Nodes.Courtyard, Nodes.BunkerDoor,     _ => true),
            (Nodes.Courtyard, Nodes.SafeSpot,       _ => true),
            (Nodes.StorageDoor, Nodes.StorageInterior, w => w.StorageUnlocked),
            (Nodes.StorageInterior, Nodes.C4Table,  _ => true),
            (Nodes.BunkerDoor, Nodes.BunkerInterior, w => w.BunkerBreached),
            (Nodes.BunkerDoor, Nodes.SafeSpot,      _ => true),
            (Nodes.BunkerInterior, Nodes.StarPos,   _ => true),
        };

        public static List<string>? FindPath(BunkerWorld w, string from, string to)
        {
            if (from == to) return new List<string> { from };
            var adj = BuildAdj(w);
            var q = new Queue<string>();
            var prev = new Dictionary<string, string?>();
            q.Enqueue(from);
            prev[from] = null;
            while (q.Count > 0)
            {
                var cur = q.Dequeue();
                if (!adj.TryGetValue(cur, out var nexts)) continue;
                foreach (var n in nexts)
                {
                    if (prev.ContainsKey(n)) continue;
                    prev[n] = cur;
                    if (n == to)
                    {
                        var path = new List<string>();
                        var p = to;
                        while (p != null)
                        {
                            path.Add(p);
                            p = prev[p!];
                        }
                        path.Reverse();
                        return path;
                    }
                    q.Enqueue(n);
                }
            }
            return null;
        }

        private static Dictionary<string, List<string>> BuildAdj(BunkerWorld w)
        {
            var map = new Dictionary<string, List<string>>();
            void Add(string a, string b)
            {
                if (!map.TryGetValue(a, out var list)) map[a] = list = new List<string>();
                list.Add(b);
            }
            foreach (var (a, b, allowed) in RawEdges)
            {
                if (allowed(w)) Add(a, b);
                if (allowed(w)) Add(b, a);
            }
            return map;
        }
    }
}


