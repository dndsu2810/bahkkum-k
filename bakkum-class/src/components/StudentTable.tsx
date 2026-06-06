import type { Student } from "../types";
import { durTotal, freqLabel, lessonDays, weekCount } from "../lib/logic";
import { Avatar, GradeBadge, StatusBadge, Empty } from "./ui";
import { Icon } from "../icons";

export function StudentTable({
  list,
  withActions,
  onEdit,
}: {
  list: Student[];
  withActions: boolean;
  onEdit?: (id: string) => void;
}) {
  if (!list.length) return <Empty>표시할 학생이 없습니다.</Empty>;
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>이름</th>
          <th>구분</th>
          {withActions && <th>상태</th>}
          {withActions && <th>학교</th>}
          <th>등록일</th>
          <th>주 횟수</th>
          <th>요일</th>
          {withActions ? <th style={{ textAlign: "right" }}>수정</th> : <th>비고</th>}
        </tr>
      </thead>
      <tbody>
        {list.map((s) => {
          const chips = lessonDays(s);
          return (
            <tr key={s.id}>
              <td>
                <span className="t-name">
                  <Avatar name={s.name} grade={s.grade} />
                  {s.name}
                </span>
              </td>
              <td>
                <GradeBadge grade={s.grade} />
              </td>
              {withActions && (
                <td>
                  <StatusBadge status={s.status ?? "재원"} />
                </td>
              )}
              {withActions && <td className="muted">{s.school || "—"}</td>}
              <td className="muted">{s.startDate}</td>
              <td>
                <span className="badge b-gray">{freqLabel(s)}</span>
              </td>
              <td>
                <div className="dchips">
                  {chips.map((d) => (
                    <span className="dchip" key={d}>
                      {d}
                    </span>
                  ))}
                </div>
              </td>
              {withActions ? (
                <td className="t-actions">
                  <button className="btn ghost sm" onClick={() => onEdit?.(s.id)}>
                    <Icon name="edit" />
                    수정
                  </button>
                </td>
              ) : (
                <td className="muted">{weekCount(s) ? durTotal(s) + "분/주" : "—"}</td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
