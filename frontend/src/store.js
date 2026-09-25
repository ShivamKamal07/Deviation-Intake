import { configureStore } from "@reduxjs/toolkit";
import deviation from "./deviationSlice";

export default configureStore({ reducer: { deviation } });
