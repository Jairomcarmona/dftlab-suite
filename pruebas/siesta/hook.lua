local it = 0
local shown = false
function siesta_comm()
  if siesta.state == siesta.SCF_LOOP then
    if not shown then siesta.print_allowed(); shown = true end
    it = it + 1
    siesta.receive({"E.total","E.Fermi","E.Kinetic","E.Exchange_Correlation","SCF.Mixer.Weight"})
    print(string.format("LUAHOOK it=%d Etot=%s EF=%s Ekin=%s Exc=%s w=%s", it, tostring(siesta.E.total), tostring(siesta.E.Fermi), tostring(siesta.E.Kinetic), tostring(siesta.E.Exchange_Correlation), tostring(siesta.SCF.Mixer.Weight)))
    if it == 5 then siesta.SCF.Mixer.Weight = 0.6; siesta.send({"SCF.Mixer.Weight"}) end
  end
end
