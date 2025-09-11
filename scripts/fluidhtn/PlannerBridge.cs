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
}


