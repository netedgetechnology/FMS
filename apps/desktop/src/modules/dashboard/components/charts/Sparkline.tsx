import {
    Area,
    AreaChart,
    ResponsiveContainer,
} from "recharts";

export interface SparklineProps {
    color: string;
    data: { value: number }[];
}

export function Sparkline({
    color,
    data,
}: SparklineProps) {
    return (
        <div className="h-14 w-full">
            <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data}>
                    <Area
                        type="monotone"
                        dataKey="value"
                        stroke={color}
                        fill={color}
                        fillOpacity={0.12}
                        strokeWidth={2}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}

