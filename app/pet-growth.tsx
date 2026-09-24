import { Redirect, useLocalSearchParams } from "expo-router";
export default function PetGrowthRoute() { const params = useLocalSearchParams(); return <Redirect href={{ pathname: "/pet", params: { ...params, section: "growth" } }} />; }
